import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [MISFILE-DETECT] Deterministic misfile detection at import time — before any model call.
 *
 * A WhatsApp export names its participants, so if a rep files Ahmed's chat under Meridian we can
 * often tell from the transcript alone. We compare the transcript's participants against the
 * selected client (its name, its known people from the stakeholder map, and — strongest — its
 * stored phone) and, when they don't match, against the rep's OTHER clients to suggest the right one.
 *
 * Doctrine (spec, same as meetings/card-scan): CONFIRM, never block; SUGGEST, never auto-reassign.
 * And bias against nagging: on a first import (no known people, no phone) we cannot check, so we
 * stay silent rather than cry misfile at every new client.
 */
export interface ClientIdentity {
  id: string;
  name: string;
  phone: string | null;
  /** [ALIAS] Learned WhatsApp display names for this client (e.g. "Bubu DXB" → Imtinan). */
  aliases?: string[];
}

export interface MisfileInput {
  messages: ImportedMessage[];
  selected: ClientIdentity;
  /** Names on the selected client's stakeholder map (extracted people across their notes). */
  knownPeople: string[];
  /** The rep's other clients (each with their own known people), to suggest the right one. */
  others: Array<ClientIdentity & { knownPeople: string[] }>;
  /** [ALIAS-COUNTERPART] the rep's own WhatsApp display name, to identify the counterpart by
   *  elimination (the speaker who is not the rep). Null/unknown → counterpart inferred when possible. */
  repName?: string | null;
}

export type MisfileDetection =
  | { status: 'ok'; counterparts: string[]; counterpart: string | null; group: boolean; learnRepName: string | null }
  | { status: 'mismatch'; counterparts: string[]; counterpart: string | null; group: boolean; suggestion: { id: string; name: string } | null; learnRepName: string | null };

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** A participant token that is just a phone number (unsaved contact) — digits, +, spaces, dashes. */
function isPhone(sender: string): boolean {
  const digits = sender.replace(/[^0-9]/g, '');
  return digits.length >= 7 && /^[+0-9()\-\s]+$/.test(sender.trim());
}

/** Two phone numbers match on their last 8 significant digits (ignores country-code formatting). */
function phonesMatch(a: string, b: string): boolean {
  const da = a.replace(/[^0-9]/g, '');
  const db = b.replace(/[^0-9]/g, '');
  if (da.length < 7 || db.length < 7) return false;
  const n = Math.min(8, da.length, db.length);
  return da.slice(-n) === db.slice(-n);
}

/** Significant word tokens of a name (≥3 chars) — so "Sarah Lee" and "Sarah" share `sarah`, but a
 *  2-letter token like "Me" never spuriously lands inside "Meridian". */
function words(name: string): Set<string> {
  return new Set(norm(name).split(' ').filter((w) => w.length >= 3));
}

/** Does a name match another — exact, or sharing a significant word (whole-word, not substring)? */
export function nameMatches(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wb = words(b);
  for (const w of words(a)) if (wb.has(w)) return true;
  return false;
}

// The device owner's own messages carry a self-label, never a counterpart's identity.
const SELF_LABELS = new Set(['me', 'you']);

/** Distinct participant identities in the transcript (sender names + phone-number senders),
 *  excluding the rep's own self-label. */
function participantsOf(messages: ImportedMessage[]): string[] {
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

/** Does any participant match this client — by phone (strongest), name, a known person, or a
 *  learned ALIAS (the nickname/company/script the contact is saved under)? Match order per the
 *  ALIAS spec: exact/word name → alias → known people (phone short-circuits when present). */
function clientMatched(participants: string[], client: ClientIdentity, knownPeople: string[]): boolean {
  const aliases = client.aliases ?? [];
  for (const p of participants) {
    if (isPhone(p)) {
      if (client.phone && phonesMatch(p, client.phone)) return true;
      continue; // a phone that doesn't match this client's phone is not a name signal
    }
    if (nameMatches(p, client.name)) return true;
    if (aliases.some((a) => nameMatches(p, a))) return true;
    if (knownPeople.some((kp) => nameMatches(p, kp))) return true;
  }
  return false;
}

/** [ALIAS-COUNTERPART] The counterpart is the speaker who is NOT the rep. With the rep's own name
 *  known, identify by elimination; without it, only a single non-self speaker is unambiguous.
 *  Returns null for a group chat (>2 speakers) or when elimination is ambiguous. */
function counterpartOf(participants: string[], repName: string | null | undefined): string | null {
  const names = participants.filter((p) => !isPhone(p));
  if (names.length > 2) return null; // group chat — the two-speaker rule doesn't apply
  if (repName) {
    const nonRep = names.filter((p) => !nameMatches(p, repName));
    return nonRep.length === 1 ? nonRep[0]! : null;
  }
  return names.length === 1 ? names[0]! : null; // rep unknown → only a lone counterpart is certain
}

export function detectMisfileAtImport(input: MisfileInput): MisfileDetection {
  const participants = participantsOf(input.messages);
  const counterparts = participants.filter((p) => !isPhone(p));
  const group = counterparts.length > 2;
  const counterpart = counterpartOf(participants, input.repName);

  if (participants.length === 0) return { status: 'ok', counterparts, counterpart, group, learnRepName: null };

  // Filed correctly if any participant matches the selected client (name → alias → known people).
  if (clientMatched(participants, input.selected, input.knownPeople)) {
    // [ALIAS-COUNTERPART] Learn the rep's own name on a clean two-speaker match: the matching
    // speaker is the client, so the OTHER is the rep. Only when the rep name isn't known yet.
    let learnRepName: string | null = null;
    if (!input.repName && counterparts.length === 2) {
      const matching = counterparts.find((p) => clientMatched([p], input.selected, input.knownPeople));
      const other = counterparts.find((p) => p !== matching);
      if (matching && other) learnRepName = other;
    }
    return { status: 'ok', counterparts, counterpart, group, learnRepName };
  }

  // Does the transcript positively match one of the rep's OTHER clients? The strongest misfile
  // signal — it names the right client.
  const matchedOthers = input.others.filter((c) => clientMatched(participants, c, c.knownPeople));
  const suggestion = matchedOthers.length === 1 ? { id: matchedOthers[0]!.id, name: matchedOthers[0]!.name } : null;

  // No match to the filed client. CONFIRM before extraction (the ordering rule): the counterpart is
  // saved under a name we don't yet know for this client. Confirming teaches the alias; it never
  // blocks, and it costs no model call because it fires before the note is even created.
  return { status: 'mismatch', counterparts, counterpart, group, suggestion, learnRepName: null };
}

/**
 * [MISFILE-POST] Softer, content-only misfile detection AFTER extraction — for voice notes and
 * pastes, which carry no participant metadata. The only signal is who the note mentions.
 *
 * Conservative by design: over-flagging trains the rep to ignore the queue. We flag ONLY when a
 * note filed under B mentions people who are on ANOTHER client's record and NONE who are on B's —
 * zero overlap with the filed client (spec), not merely a better match elsewhere. Deterministic:
 * extracted people vs known people, no model call, no prompt change.
 */
export interface PostMisfileInput {
  /** People names extracted from THIS note. */
  notePeople: string[];
  filedClient: { id: string; name: string };
  /** People on the filed client's record from their OTHER notes (never this note's own). */
  filedClientOtherPeople: string[];
  /** The rep's other clients with the people on their records. */
  others: Array<{ id: string; name: string; people: string[] }>;
}

export type PostMisfileResult =
  | { status: 'ok' }
  | { status: 'suggest_move'; to: { id: string; name: string } | null; mentioned: string[]; reason: string };

const anyNameMatch = (names: string[], pool: string[]): boolean => names.some((n) => pool.some((p) => nameMatches(n, p)));

export function detectMisfilePostExtraction(input: PostMisfileInput): PostMisfileResult {
  const people = input.notePeople.map((p) => p.trim()).filter(Boolean);
  if (people.length === 0) return { status: 'ok' }; // nothing to reason from

  // Any overlap with the filed client → correctly filed (the conservative gate).
  if (anyNameMatch(people, input.filedClientOtherPeople)) return { status: 'ok' };

  // Zero overlap with B. Only flag if the mentions positively land on another client A.
  const matched = input.others.filter((c) => anyNameMatch(people, c.people));
  if (matched.length === 0) return { status: 'ok' };

  const to = matched.length === 1 ? { id: matched[0]!.id, name: matched[0]!.name } : null;
  const mentioned = people.filter((n) => matched.some((c) => c.people.some((p) => nameMatches(n, p))));
  const whose = to ? `${to.name}'s` : `another client's`;
  const list = mentioned.length ? mentioned.join(' and ') : 'people';
  return { status: 'suggest_move', to, mentioned, reason: `This note mentions ${list}, who are on ${whose} record. Move it?` };
}
