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
  budget: TypeRecall & { staleAlsoCurrent: number };
  meetings: TypeRecall;
  keyDates: TypeRecall;
  decisionDate: boolean;
  duplicates: number;
  pass: boolean;
  misses: string[];
}

const lc = (s: string | null | undefined): string => (s ?? '').toLowerCase();

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

function promiseMatches(e: ExpectedPromise, x: Extraction['promises'][number]): boolean {
  return lc(`${x.text} ${x.due_raw ?? ''}`).includes(e.match.toLowerCase()) && x.owner === e.owner;
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
  const kdKeys = actual.key_dates.map((k) => `${k.resolved_date ?? k.date}|${lc(k.description)}`);
  duplicates += kdKeys.length - new Set(kdKeys).size;
  for (const k of expected.keyDates) {
    const hit = actual.key_dates.some((x) => {
      const d = x.resolved_date ?? x.date;
      const text = lc(`${x.description} ${x.date_raw ?? ''}`);
      return k.day !== null ? d === k.day || (k.anyOf.some((a) => text.includes(a)) && (d === k.day || d === null)) : k.anyOf.some((a) => text.includes(a));
    });
    const elsewhere = k.decision && [...actual.next_steps, ...(actual.requirements ?? []).map((r) => r.requirement_raw)].some((t) => k.anyOf.some((a) => lc(t).includes(a)));
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
    budget: { found: bFound, expected: 1, staleAlsoCurrent },
    meetings: { found: mFound, expected: expected.meetings.length },
    keyDates: { found: kFound, expected: expected.keyDates.length },
    decisionDate: decision,
    duplicates,
    pass,
    misses,
  };
}
