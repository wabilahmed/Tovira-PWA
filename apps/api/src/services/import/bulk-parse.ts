/**
 * [BULK-IMPORT · Task 2] Deterministic multi-file WhatsApp parse + rep-by-elimination + client matching.
 * PURE — no network, no model, no clock-dependent output. Builds on the single-file parser
 * (parseWhatsAppExport) and reuses the single-file identity primitives (norm/isPhone/phonesMatch/
 * nameMatches from misfile.ts) so a bulk match decides EXACTLY as a single-file import would (D3: a
 * normalised-name match is a POSSIBLE match, never a silent merge).
 */
import { parseWhatsAppExport, type ParsedMessage } from './whatsapp.js';
import { norm, isPhone, phonesMatch, nameMatches } from './misfile.js';

/**
 * [D7] Max files per bulk upload. Derivation: onboarding asks for the rep's ten most active clients;
 * 20 gives full headroom for that plus stragglers while keeping the review screen to a single phone
 * scroll. A rep with more uploads twice. NOT settled — revisit if onboarding changes.
 */
export const BULK_MAX_FILES = 20;

/** The rep's own messages are self-labelled in some exports; never a counterpart identity. */
const SELF_LABELS = new Set(['me', 'you']);

export interface BulkInputFile {
  name: string;
  content: string;
}
export interface BulkClient {
  id: string;
  name: string;
  phone?: string | null;
  aliases?: string[];
}

export type RowState =
  | 'new' // clear counterpart name, no existing match → new client
  | 'existing' // STRONG match (phone, or same chat re-exported) → auto-attach, no question (RULING 2 item 4)
  | 'possible_match' // name-only match to an existing client → "Same person?" (D3)
  | 'unsaved_intro' // bare number, a self-introduction found → suggest the name (D5)
  | 'unsaved_no_intro' // bare number, no intro → "Who is this?" (D5)
  | 'group' // >2 senders → skipped by default (D4)
  | 'duplicate' // same chat as another file → shown once, not imported twice
  | 'unparseable' // could not read this file
  | 'needs_rep_id'; // single file, rep can't be eliminated → "which of these is you?" (once)

export interface BulkRow {
  fileName: string;
  platform: 'ios' | 'android' | null;
  state: RowState;
  /** The label to show: the counterpart's name, or the bare number, or null (group/unparseable). */
  counterpart: string | null;
  /** [D5] suggested name from a self-introduction (unsaved_intro only) — the rep confirms it. */
  suggestedName?: string;
  /** [existing / possible_match] the existing client this chat matches. */
  matchClientId?: string;
  matchClientName?: string;
  /** How the match was made: 'phone' auto-attaches (existing); 'name' asks "Same person?". */
  matchKind?: 'phone' | 'name';
  /** [existing] how many messages are NEW vs what is already stored for the client (0 → up to date).
   *  Filled by the service (parseBatch has no access to stored notes). */
  newMessageCount?: number;
  /** [duplicate] the file this is a duplicate of. */
  duplicateOfFileName?: string;
  /** [group / needs_rep_id] the distinct senders, so the rep can pick the client / pick themselves. */
  participants?: string[];
}

export interface BulkParseResult {
  rows: BulkRow[];
  /** The rep resolved by elimination or the stored name; null when it could not be determined. */
  repName: string | null;
  /** True → the review screen must ask "which of these is you?" once (single-file / ambiguous). */
  needsRepId: boolean;
}

interface ParsedFile {
  name: string;
  platform: 'ios' | 'android' | null;
  ok: boolean;
  messages: ParsedMessage[];
  senders: string[]; // distinct, original display form, self-labels excluded
}

/** iOS exports bracket the timestamp (`[ts] Name: …`); Android uses `ts - Name: …`. First header wins. */
function detectPlatform(content: string): 'ios' | 'android' | null {
  for (const raw of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[[^\]]+\]\s*[^:]+:/.test(line)) return 'ios';
    if (/^\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?\s*-\s*[^:]+:/.test(line)) return 'android';
  }
  return null;
}

/** Distinct senders (original form), self-labels (me/you) excluded, deduped by normalised key. */
function distinctSenders(messages: ParsedMessage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    const s = m.sender.trim();
    if (!s || SELF_LABELS.has(norm(s))) continue;
    const key = norm(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Resolve the rep: the stored name if it matches a sender anywhere, else the one sender common to
 *  EVERY one-to-one file (≥2 such files needed — with a single file both senders are "common" and the
 *  rep cannot be told apart). Returns the rep's display form, or null if undeterminable. */
function resolveRep(files: ParsedFile[], storedRepName: string | null | undefined): string | null {
  const oneToOne = files.filter((f) => f.ok && f.senders.filter((s) => !isPhone(s)).length === 2);
  if (storedRepName && storedRepName.trim()) {
    for (const f of files) {
      const hit = f.senders.find((s) => !isPhone(s) && nameMatches(s, storedRepName));
      if (hit) return storedRepName.trim();
    }
  }
  if (oneToOne.length < 2) return null; // elimination needs at least two one-to-one files
  // The normalised sender present in every one-to-one file.
  const [first, ...rest] = oneToOne;
  const candidates = first!.senders.filter((s) => !isPhone(s)).map((s) => ({ norm: norm(s), display: s }));
  const common = candidates.filter((c) => rest.every((f) => f.senders.some((s) => norm(s) === c.norm)));
  return common.length === 1 ? common[0]!.display : null;
}

// Self-introduction patterns (D5), conservative — capture a single name token right after the phrase.
// Case-insensitive on the phrase; the captured name keeps its original casing (returned verbatim as a
// SUGGESTION the rep confirms, never applied silently). Deliberately only explicit "I am / this is /
// my name is" forms — looser cues would guess wrong for someone.
const INTRO_RES = [
  /\bi['’]?m\s+(\p{L}[\p{L}'’-]+)/iu,
  /\bthis is\s+(\p{L}[\p{L}'’-]+)/iu,
  /\bmy name is\s+(\p{L}[\p{L}'’-]+)/iu,
];
function findIntro(messages: ParsedMessage[], counterpartNorm: string): string | undefined {
  for (const m of messages) {
    if (norm(m.sender) !== counterpartNorm) continue;
    for (const re of INTRO_RES) {
      const hit = re.exec(m.body);
      if (hit?.[1]) return hit[1];
    }
  }
  return undefined;
}

/** First existing client that a non-phone name OR a phone matches (name → alias → phone). Never merges. */
function matchClient(counterpart: string, clients: BulkClient[]): BulkClient | undefined {
  const phone = isPhone(counterpart);
  for (const c of clients) {
    if (phone) {
      if (c.phone && phonesMatch(counterpart, c.phone)) return c;
      continue;
    }
    if (nameMatches(counterpart, c.name)) return c;
    if ((c.aliases ?? []).some((a) => nameMatches(counterpart, a))) return c;
  }
  return undefined;
}

/** Normalised (sender|body) signature set, for duplicate detection by content overlap. */
function messageSet(messages: ParsedMessage[]): Set<string> {
  return new Set(messages.map((m) => `${norm(m.sender)}|${norm(m.body)}`));
}

export function parseBatch(files: BulkInputFile[], clients: BulkClient[], storedRepName?: string | null): BulkParseResult {
  const parsed: ParsedFile[] = files.map((f) => {
    const res = parseWhatsAppExport(f.content);
    if (!res.ok || res.messages.length === 0) return { name: f.name, platform: detectPlatform(f.content), ok: false, messages: [], senders: [] };
    return { name: f.name, platform: detectPlatform(f.content), ok: true, messages: res.messages, senders: distinctSenders(res.messages) };
  });

  const repName = resolveRep(parsed, storedRepName);
  // needsRepId when a parseable one-to-one file exists but we could not determine the rep.
  const anyOneToOne = parsed.some((f) => f.ok && f.senders.filter((s) => !isPhone(s)).length === 2);
  const needsRepId = repName === null && anyOneToOne;

  // First pass: per-file row (counterpart + state), before duplicate overlay.
  const rows: BulkRow[] = parsed.map((f) => {
    if (!f.ok) return { fileName: f.name, platform: f.platform, state: 'unparseable', counterpart: null };

    const nonPhone = f.senders.filter((s) => !isPhone(s));
    if (nonPhone.length > 2) {
      return { fileName: f.name, platform: f.platform, state: 'group', counterpart: null, participants: f.senders };
    }
    if (needsRepId) {
      return { fileName: f.name, platform: f.platform, state: 'needs_rep_id', counterpart: null, participants: f.senders };
    }
    // Counterpart = the sender who is NOT the rep.
    const others = f.senders.filter((s) => !(repName && nameMatches(s, repName)));
    const counterpart = others.length >= 1 ? others[0]! : null;
    if (!counterpart) return { fileName: f.name, platform: f.platform, state: 'unparseable', counterpart: null };

    if (isPhone(counterpart)) {
      // A stored client phone is the STRONGEST identity signal — an EXACT phone match auto-attaches to
      // that existing client with no question (RULING 2 item 4), ahead of any self-intro guess.
      const phoneMatch = matchClient(counterpart, clients);
      if (phoneMatch) return { fileName: f.name, platform: f.platform, state: 'existing', counterpart, matchClientId: phoneMatch.id, matchClientName: phoneMatch.name, matchKind: 'phone' };
      const suggested = findIntro(f.messages, norm(counterpart));
      return suggested
        ? { fileName: f.name, platform: f.platform, state: 'unsaved_intro', counterpart, suggestedName: suggested }
        : { fileName: f.name, platform: f.platform, state: 'unsaved_no_intro', counterpart };
    }
    // A NAME match is not strong enough to attach silently (two different people share a name) — ask.
    const match = matchClient(counterpart, clients);
    return match
      ? { fileName: f.name, platform: f.platform, state: 'possible_match', counterpart, matchClientId: match.id, matchClientName: match.name, matchKind: 'name' }
      : { fileName: f.name, platform: f.platform, state: 'new', counterpart };
  });

  // Duplicate overlay: files sharing the same counterpart whose messages are a subset of a larger
  // file with that counterpart are re-exports of the same chat (D: "share both senders"); keep the
  // largest, mark the rest duplicate. Non-overlapping same-name files are distinct chats — kept.
  const byCounterpart = new Map<string, number[]>(); // counterpartNorm → row indices (importable states)
  const importable = new Set<RowState>(['new', 'existing', 'possible_match']);
  rows.forEach((r, i) => {
    if (r.counterpart && importable.has(r.state)) {
      const k = norm(r.counterpart);
      (byCounterpart.get(k) ?? byCounterpart.set(k, []).get(k)!).push(i);
    }
  });
  for (const idxs of byCounterpart.values()) {
    if (idxs.length < 2) continue;
    const sorted = [...idxs].sort((a, b) => parsed[b]!.messages.length - parsed[a]!.messages.length);
    const keep = sorted[0]!;
    const keepSet = messageSet(parsed[keep]!.messages);
    for (const i of sorted.slice(1)) {
      const subset = [...messageSet(parsed[i]!.messages)].every((sig) => keepSet.has(sig));
      if (subset) rows[i] = { ...rows[i]!, state: 'duplicate', duplicateOfFileName: parsed[keep]!.name };
    }
  }

  return { rows, repName, needsRepId };
}
