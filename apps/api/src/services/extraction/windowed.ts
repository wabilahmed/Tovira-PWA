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
 *  - one meeting (the schema holds one): the most recently arranged.
 * `markKeptPromises` then decides, over the WHOLE chat, whether a promise was later fulfilled — so a promise
 * made in window 1 and kept in window 3 does not stay open just because the windows were read apart.
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

const AMOUNT = /\d[\d,.]*\s*(?:m\b|mn\b|million\b|k\b)?/gi;
const VALUE_NEED = /\b(budget|price|rent|offer|afford|stretch|up to|max(?:imum)?|top)\b/i;
/** A value-bearing need with its amounts removed — "budget around AED 2.5M" and "…3.1M" share this. */
function valueSlot(r: Requirement): string | null {
  const t = `${r.text} ${r.requirement_raw}`;
  if (!VALUE_NEED.test(t) || !AMOUNT.test(t)) return null;
  AMOUNT.lastIndex = 0;
  return VALUE_NEED.exec(t)![1]!.toLowerCase();
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
  const requirements = reqs.filter((r) => { const s = valueSlot(r); return !s || lastOfSlot.get(s) === r; });

  const keyDate = (k: KeyDate) => `${k.date ?? ''}|${norm(k.description)}`;
  const key_dates = dedupeBy(parts.flatMap((x) => x.key_dates), keyDate);
  const personal_facts = dedupeBy(parts.flatMap((x) => x.personal_facts), (f: PersonalFact) => `${norm(f.subject)}|${norm(f.fact)}`);
  const meetings = parts.map((x) => x.meeting).filter((m): m is NonNullable<Extraction['meeting']> => m !== null);
  const meeting = meetings.length === 0 ? null : meetings.reduce((a, b) => ((b.source_message_at ?? '') >= (a.source_message_at ?? '') ? b : a));
  const pointers = parts.some((x) => x.pointers) ? dedupeBy(parts.flatMap((x) => x.pointers ?? []), (p) => `${p.section}|${norm(p.text)}`) : undefined;

  return {
    summary: dedupeBy(parts.map((x) => x.summary.trim()).filter(Boolean), norm).join(' '),
    promises,
    people: mergePeople(parts.map((x) => x.people)),
    personal_facts,
    key_dates,
    concerns: dedupeBy(parts.flatMap((x) => x.concerns), norm),
    next_steps: dedupeBy(parts.flatMap((x) => x.next_steps), norm),
    requirements,
    meeting,
    ...(pointers ? { pointers } : {}),
  };
}

// "Here are the options", "as promised", "attached", "sent you…", "came back with…" — delivery, not intent.
const DELIVERED = /\b(here (?:is|are)|herewith|attached|as promised|please find|sent (?:you|over|it|them|the)|i(?:'ve| have) sent|shared|forwarded|came back)\b/i;
const NOT_DONE = /\b(not|still|haven'?t|hasn'?t|didn'?t|waiting|yet|when will|any update)\b/i;

/**
 * Over the whole chat: a promise is KEPT when, after the message that made it, the party who owns it says
 * it was delivered and names what was promised (a content word in common). Sets `kept_at` to that message's
 * time. Deterministic and conservative — a complaint ("still not fixed"), the other party's message, or a
 * delivery before the promise never counts. Mutates in place.
 */
export function markKeptPromises(extraction: Extraction, messages: ImportedMessage[]): void {
  for (const p of extraction.promises) {
    if (p.kept_at || !p.source_message_at) continue;
    const terms = queryTerms(p.text);
    if (terms.length === 0) continue;
    const ownerRole = p.owner === 'rep' ? 'rep' : 'client';
    const hit = messages.find((m) =>
      m.sentAt !== null && m.sentAt > p.source_message_at! && !m.excluded && m.role === ownerRole &&
      DELIVERED.test(m.body) && !NOT_DONE.test(m.body) && termHits(terms, m.body) > 0);
    if (hit) p.kept_at = hit.sentAt;
  }
}
