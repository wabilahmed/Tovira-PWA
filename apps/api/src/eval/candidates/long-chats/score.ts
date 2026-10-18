import type { Extraction } from '../../../services/extraction/types.js';
import type { LongChatExpected, ExpectedPromise } from './fixtures.js';

/**
 * [P23-B3] Score one long-chat extraction against its hand-written expected facts: recall per fact type,
 * duplicates, promise status, and the B5 pass bar (budget + final decision date + main requirement found,
 * no duplicates, promise status correct).
 *
 * A promise counts as KEPT when the extraction marks it (`kept_at`, set by the windowed merge) — the
 * single-pass engine has no such field, so a fulfilled promise it returns stays OPEN, which is wrong.
 */
export interface TypeRecall { found: number; expected: number }
export interface LongChatScore {
  promises: TypeRecall;
  promiseDates: TypeRecall;
  promiseStatus: TypeRecall;
  requirements: TypeRecall;
  budget: TypeRecall & { staleAlsoCurrent: number; /** the current value appears only in the free-text summary */ inSummaryOnly: boolean };
  meetings: TypeRecall;
  keyDates: TypeRecall;
  decisionDate: boolean;
  duplicates: number;
  pass: boolean;
  misses: string[];
}

const lc = (s: string | null | undefined): string => (s ?? '').toLowerCase();

// The scorer's OWN near-duplicate test (independent of the merge code it grades): content words ≥ 3 chars,
// light stemming, ≥ 75% of the smaller set shared.
const SCORE_STOP = new Set(['the', 'and', 'for', 'with', 'has', 'have', 'been', 'are', 'was', 'not', 'still', 'his', 'her', 'their', 'client', 'very', 'this', 'that', 'from', 'after']);
const words = (s: string): string[] => [...new Set(lc(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !SCORE_STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, '')))];
function nearDuplicates(texts: string[]): number {
  let dups = 0;
  const kept: string[][] = [];
  for (const t of texts) {
    const w = words(t);
    if (kept.some((k) => w.length >= 2 && k.length >= 2 && w.filter((x) => k.includes(x)).length / Math.min(w.length, k.length) >= 0.75)) dups += 1;
    else kept.push(w);
  }
  return dups;
}

/** Every money amount in a text, in whole units: "3.1M" / "3.1 million" → 3100000; "152,000" → 152000. */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  const t = text.toLowerCase();
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(m\b|mn\b|million\b)/g)) out.push(Math.round(Number(m[1]) * 1_000_000));
  for (const m of t.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d{5,})(?![\d.]*\s*(?:m\b|mn\b|million\b))/g)) out.push(Number(m[1]!.replace(/,/g, '')));
  return out;
}
const amountOf = (s: string): number => amountsIn(s)[0] ?? NaN;

/** All structured text a rep would see a budget in (not the free-text summary). */
function budgetSurfaces(x: Extraction): string[] {
  return [
    ...(x.requirements ?? []).map((r) => `${r.text} ${r.requirement_raw}`),
    ...x.key_dates.map((k) => `${k.description} ${k.date_raw ?? ''}`),
    ...x.personal_facts.map((f) => f.fact),
    ...x.people.map((p) => p.notes ?? ''),
    ...x.concerns,
    ...x.next_steps,
  ];
}

/** Every keyword of `match` appears in `text` as a whole word (a keyword of ≥ 4 chars may carry a suffix:
 *  "cheque" ⟶ "cheques"), in any order — robust to the model rewording a promise. */
export function keywordsMatch(match: string, text: string): boolean {
  const t = lc(text);
  return match.toLowerCase().split(/\s+/).filter(Boolean).every((k) => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}${k.length >= 4 ? '' : '(?![\\p{L}\\p{N}])'}`, 'u').test(t);
  });
}

function promiseMatches(e: ExpectedPromise, x: Extraction['promises'][number]): boolean {
  return keywordsMatch(e.match, `${x.text} ${x.due_raw ?? ''}`) && x.owner === e.owner;
}

export function scoreLongChat(expected: LongChatExpected, actual: Extraction): LongChatScore {
  const misses: string[] = [];
  let duplicates = 0;

  // Promises: found (text + owner), date right, status right.
  let pFound = 0; let pDate = 0; let pStatus = 0;
  for (const e of expected.promises) {
    const hits = actual.promises.filter((x) => promiseMatches(e, x));
    if (hits.length > 1) duplicates += hits.length - 1;
    const p = hits[0];
    if (!p) { misses.push(`promise "${e.match}"`); if (e.status === 'kept') pStatus += 0; continue; }
    pFound += 1;
    const due = p.resolved_due_date ?? p.due_date;
    if (due === e.due) pDate += 1; else misses.push(`promise "${e.match}" due ${due ?? 'null'} ≠ ${e.due ?? 'null'}`);
    const kept = Boolean((p as { kept_at?: string | null }).kept_at);
    if ((e.status === 'kept') === kept) pStatus += 1; else misses.push(`promise "${e.match}" should be ${e.status}, is ${kept ? 'kept' : 'open'}`);
  }

  // Requirements (the main need) — and duplicate requirements (same normalised text).
  let rFound = 0;
  for (const r of expected.requirements) {
    if ((actual.requirements ?? []).some((x) => r.anyOf.some((a) => lc(`${x.text} ${x.requirement_raw}`).includes(a)))) rFound += 1;
    else misses.push(`requirement "${r.id}"`);
  }
  const reqKeys = (actual.requirements ?? []).map((x) => lc(x.text).replace(/\s+/g, ' ').trim());
  duplicates += reqKeys.length - new Set(reqKeys).size;

  // Budget: the current value must be on a structured surface; an older value presented too is "stale".
  const surfaces = budgetSurfaces(actual).flatMap(amountsIn);
  const current = amountOf(expected.budget.current);
  const bFound = surfaces.includes(current) ? 1 : 0;
  if (!bFound) misses.push(`budget ${expected.budget.current}`);
  const staleAlsoCurrent = expected.budget.history.filter((h) => surfaces.includes(amountOf(h))).length;

  // Meetings (the schema holds ONE meeting per extraction).
  let mFound = 0;
  for (const m of expected.meetings) {
    const mt = actual.meeting;
    const day = (mt?.resolved_datetime ?? mt?.datetime ?? '').slice(0, 10);
    if (mt && (day === m.day || m.anyOf.some((a) => lc(mt.datetime_raw).includes(a)))) mFound += 1;
    else misses.push(`meeting ${m.day}`);
  }

  // Key dates (+ the decision date of the pass bar). Decision may also sit in next_steps/requirements.
  let kFound = 0; let decision = false;
  duplicates += nearDuplicates(actual.concerns) + nearDuplicates(actual.next_steps);
  const bySubject = new Map<string, string[]>();
  for (const f of actual.personal_facts) bySubject.set(lc(f.subject), [...(bySubject.get(lc(f.subject)) ?? []), f.fact]);
  for (const facts of bySubject.values()) duplicates += nearDuplicates(facts);
  const kdKeys = actual.key_dates.map((k) => `${k.resolved_date ?? k.date}|${lc(k.description)}`);
  duplicates += kdKeys.length - new Set(kdKeys).size;
  for (const k of expected.keyDates) {
    const hit = actual.key_dates.some((x) => {
      const d = x.resolved_date ?? x.date;
      const text = lc(`${x.description} ${x.date_raw ?? ''}`);
      return k.day !== null ? d === k.day || (k.anyOf.some((a) => text.includes(a)) && (d === k.day || d === null)) : k.anyOf.some((a) => text.includes(a));
    });
    // A decision date may also be surfaced as a next step, a requirement, or a promise due that day
    // ("Decide on Villa 22", due 15 Jun) — the rep sees it either way.
    const elsewhere = k.decision && (
      [...actual.next_steps, ...(actual.requirements ?? []).map((r) => r.requirement_raw)].some((t) => k.anyOf.some((a) => lc(t).includes(a))) ||
      actual.promises.some((p) => k.anyOf.some((a) => lc(`${p.text} ${p.due_raw ?? ''}`).includes(a)) && (k.day === null || (p.resolved_due_date ?? p.due_date) === k.day)));
    if (hit) kFound += 1; else misses.push(`key date ${k.day ?? k.anyOf.join('/')}`);
    if (k.decision && (hit || elsewhere)) decision = true;
  }

  const promiseStatusOk = pStatus === expected.promises.length;
  const pass = bFound === 1 && decision && rFound === expected.requirements.length && duplicates === 0 && promiseStatusOk;
  return {
    promises: { found: pFound, expected: expected.promises.length },
    promiseDates: { found: pDate, expected: expected.promises.length },
    promiseStatus: { found: pStatus, expected: expected.promises.length },
    requirements: { found: rFound, expected: expected.requirements.length },
    budget: { found: bFound, expected: 1, staleAlsoCurrent, inSummaryOnly: bFound === 0 && amountsIn(actual.summary).includes(current) },
    meetings: { found: mFound, expected: expected.meetings.length },
    keyDates: { found: kFound, expected: expected.keyDates.length },
    decisionDate: decision,
    duplicates,
    pass,
    misses,
  };
}
