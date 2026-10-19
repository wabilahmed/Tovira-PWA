/**
 * [P23-B4 / EXT-10] Windowed extraction for long chats — the pure parts.
 *
 * A long chat sent in one call is under-extracted (a lost-in-the-middle recall failure, not truncation).
 * Over a threshold of N messages the chat is split into windows of W messages overlapping by O; each window
 * goes through the SAME certified prompt + model with the same metadata (no new instructions), and the
 * window extractions are merged here, deterministically:
 *  - DEDUPE: the same fact from two windows (the overlap) is one fact — promises / key dates by normalised
 *    text + source message time, requirements by normalised phrase, people by normalised NAME (two different
 *    names are never merged), lists by normalised text. The first occurrence's receipt is kept.
 *  - LATER WINS: a requirement restating a value-bearing need with a different amount ("budget 2.5M" →
 *    "final budget 3.1M") is the same need updated; the later one is current. The Requirement schema has no
 *    history field, so the earlier value is not kept as a second current need (it stays in the chat).
 *    [P27-2] A later value replaces only the VALUE: an earlier requirement that says anything else ("4BR villa
 *    in Mirdif, budget around 3M") is never dropped — its stale value clause leaves the display text when it
 *    separates cleanly, else the text is kept whole; the verbatim receipt (requirement_raw) is never edited.
 *  - one meeting (the schema holds one): the most recently arranged.
 * `deliveryFor` then looks, over the WHOLE chat, for a later message that delivered a promise — so a promise
 * made in window 1 and delivered in window 3 is noticed even though the windows were read apart. [P24-2] It
 * only SUGGESTS (To Confirm); it never marks a promise done.
 */
import type { Extraction, ExtractedPromise, ExtractedPerson, KeyDate, Requirement, PersonalFact } from './types.js';
import type { ImportedMessage } from '../../ports/note-repository.js';
import { normalizeName } from '../text/normalize-name.js';
import { queryTerms, termHits } from '../recall/query-terms.js';

export interface WindowConfig {
  /** Chats with MORE than this many (model-visible) messages are windowed. */
  threshold: number;
  /** Messages per window. */
  size: number;
  /** Messages shared by consecutive windows. */
  overlap: number;
}

/** [start, end) message ranges, or null when the chat is at/below the threshold (single pass). */
export function planWindows(count: number, cfg: WindowConfig): Array<[number, number]> | null {
  if (cfg.size <= 0 || cfg.threshold <= 0) throw new Error('window size and threshold must be positive');
  if (cfg.overlap < 0 || cfg.overlap >= cfg.size) throw new Error('window overlap must be ≥ 0 and smaller than the window size');
  if (count <= cfg.threshold) return null;
  const out: Array<[number, number]> = [];
  let start = 0;
  for (;;) {
    const end = Math.min(start + cfg.size, count);
    out.push([start, end]);
    if (end >= count) break;
    const next = end - cfg.overlap;
    // A tail no longer than the overlap would only repeat what the last window already read: fold it in.
    if (count - end <= cfg.overlap) { out[out.length - 1] = [start, count]; break; }
    start = next;
  }
  return out;
}

const norm = (s: string | null | undefined): string => normalizeName(s ?? '');

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) { const k = key(it); if (seen.has(k)) continue; seen.add(k); out.push(it); }
  return out;
}

/** Two promises from one message are the same commitment when their texts mostly overlap. */
function samePromise(a: ExtractedPromise, b: ExtractedPromise): boolean {
  if (a.owner !== b.owner) return false;
  if (norm(a.text) === norm(b.text)) return (a.source_message_at ?? '') === (b.source_message_at ?? '') || !a.source_message_at || !b.source_message_at;
  if (!a.source_message_at || a.source_message_at !== b.source_message_at) return false;
  const ta = new Set(norm(a.text).split(' ').filter((t) => t.length > 2));
  const tb = new Set(norm(b.text).split(' ').filter((t) => t.length > 2));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / Math.max(1, Math.min(ta.size, tb.size)) >= 0.75;
}

const AMOUNT = /\d[\d,.]*\s*(?:m\b|mn\b|million\b|k\b)?/i;
// The value a need is about, by family: every way of stating a spending ceiling is the BUDGET slot.
const VALUE_SLOTS: Array<[string, RegExp]> = [
  ['rent', /\brent\b/i],
  ['price', /\b(price|offer|asking)\b/i],
  ['budget', /\b(budget|afford|stretch|up to|max(?:imum)?|top|spend)\b/i],
];
/** The value slot a requirement restates ("budget around AED 2.5M" / "stretch to 2.8M" / "final budget
 *  3.1M, that is the top" → 'budget'), or null when it carries no amount. */
function valueSlot(r: Requirement): string | null {
  const t = `${r.text} ${r.requirement_raw}`;
  if (!AMOUNT.test(t)) return null;
  return VALUE_SLOTS.find(([, re]) => re.test(t))?.[0] ?? null;
}

// Words that only phrase a value statement ("updated budget of", "willing to stretch to", "final … that is the
// top"). A requirement whose text has NOTHING besides these and amounts is value-only; anything else (a
// property type, an area, "4BR") is a need in its own right and is never dropped by a later value.
const VALUE_FILLER = new Set(['budget', 'budgets', 'afford', 'stretch', 'up', 'to', 'max', 'maximum', 'top', 'spend', 'rent', 'rental', 'price',
  'offer', 'asking', 'around', 'about', 'approximately', 'approx', 'roughly', 'final', 'finally', 'updated', 'update', 'now', 'new', 'revised',
  'current', 'our', 'their', 'his', 'her', 'is', 'of', 'the', 'a', 'an', 'aed', 'dhs', 'dirhams', 'willing', 'can', 'could', 'able', 'go', 'that',
  'this', 'it', 'we', 'us', 'my', 'i', 'increased', 'increase', 'raised', 'total', 'only', 'just', 'still', 'firm', 'flexible', 'maybe', 'plus',
  'million', 'mn', 'm', 'k', 'per', 'year', 'annual', 'annually', 'be', 'will', 'would', 'at', 'most', 'least', 'for', 'and']);
const valueOnly = (text: string): boolean => (text.toLowerCase().match(/[\p{L}]+/gu) ?? []).every((w) => VALUE_FILLER.has(w));
/** The text without its value clause(s) — "4BR villa in Mirdif, budget around 3M" → "4BR villa in Mirdif" —
 *  or null when the value is not a separable clause (then the caller keeps the text whole). */
function withoutValueClause(text: string, slot: string): string | null {
  const re = VALUE_SLOTS.find(([s]) => s === slot)![1];
  const parts = text.split(/\s*[,;]\s*/);
  const kept = parts.filter((c) => !(AMOUNT.test(c) && re.test(c)));
  if (kept.length === 0 || kept.length === parts.length) return null;
  const out = kept.join(', ').trim();
  return out && !valueOnly(out) ? out : null;
}

/** Two short texts state the same thing when most of the smaller one's content words are in the other
 *  (stemmed, function words dropped — query-terms). Conservative: needs ≥ 2 content words and 75%. */
function sameStatement(a: string, b: string): boolean {
  const ta = queryTerms(a);
  const tb = new Set(queryTerms(b));
  if (ta.length < 2 || tb.size < 2) return norm(a) === norm(b);
  const inter = ta.filter((t) => tb.has(t)).length;
  return inter / Math.min(ta.length, tb.size) >= 0.75;
}
function dedupeSimilar<T>(items: T[], text: (t: T) => string, group: (t: T) => string = () => ''): T[] {
  const out: T[] = [];
  for (const it of items) if (!out.some((o) => group(o) === group(it) && sameStatement(text(o), text(it)))) out.push(it);
  return out;
}

function mergePeople(lists: ExtractedPerson[][]): ExtractedPerson[] {
  const out: ExtractedPerson[] = [];
  for (const p of lists.flat()) {
    const k = norm(p.name);
    const prev = k ? out.find((x) => norm(x.name) === k) : undefined;
    if (!prev) { out.push({ ...p }); continue; }
    // Same name = same person: fill the gaps from the later window, never overwrite a stated value.
    prev.role ??= p.role;
    prev.reports_to ??= p.reports_to;
    prev.notes ??= p.notes;
    if (prev.decision_role === 'unknown') prev.decision_role = p.decision_role;
    prev.source_span ??= p.source_span;
    prev.source_message_at ??= p.source_message_at;
  }
  return out;
}

/** Merge the window extractions (in chat order) into one extraction. */
export function mergeWindowExtractions(parts: Extraction[]): Extraction {
  const promises: ExtractedPromise[] = [];
  for (const p of parts.flatMap((x) => x.promises)) if (!promises.some((q) => samePromise(q, p))) promises.push(p);

  const reqs = dedupeBy(parts.flatMap((x) => x.requirements ?? []), (r) => norm(r.requirement_raw || r.text));
  // LATER WINS for a value-bearing need: keep the last restatement of each slot.
  const lastOfSlot = new Map<string, Requirement>();
  for (const r of reqs) { const s = valueSlot(r); if (s) lastOfSlot.set(s, r); }
  const requirements: Requirement[] = [];
  for (const r of reqs) {
    const s = valueSlot(r);
    if (!s || lastOfSlot.get(s) === r) { requirements.push(r); continue; }
    if (valueOnly(r.text)) continue; // a superseded value statement and nothing else
    // [P27-2] A need that also carried the old value: keep the need, drop only the stale value from its text.
    requirements.push({ ...r, text: withoutValueClause(r.text, s) ?? r.text });
  }

  const keyDate = (k: KeyDate) => `${k.date ?? ''}|${norm(k.description)}`;
  const key_dates = dedupeBy(parts.flatMap((x) => x.key_dates), keyDate);
  // Paraphrased repeats (the overlap, or a fact restated later) are one fact — per subject for personal facts.
  const personal_facts = dedupeSimilar(parts.flatMap((x) => x.personal_facts), (f: PersonalFact) => f.fact, (f) => norm(f.subject));
  const meetings = parts.map((x) => x.meeting).filter((m): m is NonNullable<Extraction['meeting']> => m !== null);
  const meeting = meetings.length === 0 ? null : meetings.reduce((a, b) => ((b.source_message_at ?? '') >= (a.source_message_at ?? '') ? b : a));
  const pointers = parts.some((x) => x.pointers) ? dedupeBy(parts.flatMap((x) => x.pointers ?? []), (p) => `${p.section}|${norm(p.text)}`) : undefined;

  return {
    summary: dedupeBy(parts.map((x) => x.summary.trim()).filter(Boolean), norm).join(' '),
    promises,
    people: mergePeople(parts.map((x) => x.people)),
    personal_facts,
    key_dates,
    concerns: dedupeSimilar(parts.flatMap((x) => x.concerns), (c) => c),
    next_steps: dedupeSimilar(parts.flatMap((x) => x.next_steps), (c) => c),
    requirements,
    meeting,
    ...(pointers ? { pointers } : {}),
  };
}

// "Here are the options", "as promised", "attached", "sent you…", "came back with…" — delivery, not intent.
const DELIVERED = /\b(here (?:is|are)|herewith|attached|as promised|please find|sent (?:you|over|it|them|the)|i(?:'ve| have) sent|shared|forwarded|came back)\b/i;
const NOT_DONE = /\b(not|still|haven'?t|hasn'?t|didn'?t|waiting|yet|when will|any update)\b/i;

/**
 * [P24-2] Over the whole chat: the LATER message in which the promise's owner says it was delivered and
 * names what was promised (a content word in common), or null. Detection ONLY — it never changes the
 * promise: only the rep closes a promise (a wrong match must never silently close a real open one), so a
 * hit becomes a To Confirm suggestion. Conservative: a complaint ("still not fixed"), the other party's
 * message, or a delivery before the promise never counts. `ruledOut` = delivery message times the rep
 * already answered "Not yet" to — those are skipped, so only a NEW delivery message can suggest again.
 */
export function deliveryFor(
  p: Pick<ExtractedPromise, 'text' | 'owner' | 'source_message_at'>,
  messages: ImportedMessage[],
  ruledOut: ReadonlySet<string> = new Set(),
): { at: string; body: string } | null {
  if (!p.source_message_at) return null;
  const terms = queryTerms(p.text);
  if (terms.length === 0) return null;
  const ownerRole = p.owner === 'rep' ? 'rep' : 'client';
  const hit = messages.find((m) =>
    m.sentAt !== null && m.sentAt > p.source_message_at! && !ruledOut.has(m.sentAt) && !m.excluded && m.role === ownerRole &&
    DELIVERED.test(m.body) && !NOT_DONE.test(m.body) && termHits(terms, m.body) > 0);
  return hit ? { at: hit.sentAt!, body: hit.body } : null;
}
