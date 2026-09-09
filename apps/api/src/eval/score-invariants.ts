import type { Extraction, DecisionRole } from '../services/extraction/types.js';

/**
 * [GATE-IMPORT-SIZE] Invariant scoring for import-sized fixtures.
 *
 * Full-output ground truth is not honestly achievable for a 5,615-message, multi-year transcript, so
 * those fixtures are certified as an INVARIANT CONTRACT (per Wabil's ruling): the planted anchor facts
 * must be found, the trust rules must hold, nothing is fabricated. This scorer checks a contract
 * against an extraction and returns the list of violations (empty = pass).
 *
 * It is deliberately two-sided — it must FAIL a violating result AND PASS a clean one. A scorer that
 * always passes certifies nothing (the leakedValues / confidence-check / nullNamed "metric shipped
 * dark" class); one that always fails is equally useless. score-invariants.test.ts proves both
 * directions before this gates any certification run.
 */
export interface InvariantContract {
  id: string;
  /** Promises that MUST appear (recall over planted commitments). `match` = case-insensitive substring
   *  of the promise text. `dueYear`: a number → the matched promise's due_date year must equal it
   *  (multi-year / DATE-REF integrity); explicit null → due_date MUST be null (no guessed date);
   *  omit → don't check the date. */
  requiredPromises?: Array<{ match: string; dueYear?: number | null }>;
  /** Promises that MUST NOT appear — a retracted/superseded commitment, or a hypothetical. */
  forbiddenPromises?: Array<{ match: string }>;
  /** People that MUST appear, optionally pinned to a decision_role. */
  requiredPeople?: Array<{ name: string; decisionRole?: DecisionRole }>;
  /** Entities that must appear NOWHERE — a competitor, another chat's contact, a departed participant.
   *  The cross-attribution / stale-participant trap. */
  forbiddenEntities?: string[];
  /** Key dates that MUST resolve to a given year (multi-year integrity); null → date MUST be null. */
  requiredDates?: Array<{ match: string; year: number | null }>;
  /** Name pairs that must remain TWO distinct people (never merged). */
  mustNotMerge?: Array<[string, string]>;
}

export interface InvariantResult {
  id: string;
  violations: string[];
  passed: boolean;
}

const has = (hay: string, needle: string): boolean => hay.toLowerCase().includes(needle.toLowerCase());
const yearOf = (iso: string | null): number | null => (iso ? Number(iso.slice(0, 4)) : null);

export function scoreInvariants(c: InvariantContract, actual: Extraction): InvariantResult {
  const v: string[] = [];

  for (const rp of c.requiredPromises ?? []) {
    const p = actual.promises.find((x) => has(x.text, rp.match));
    if (!p) { v.push(`missing required promise: "${rp.match}"`); continue; }
    if (rp.dueYear === null && p.due_date !== null) {
      v.push(`promise "${rp.match}" must have NO date (guessed ${p.due_date})`);
    } else if (typeof rp.dueYear === 'number' && yearOf(p.due_date) !== rp.dueYear) {
      v.push(`promise "${rp.match}" date must resolve to ${rp.dueYear}, got ${p.due_date ?? 'null'}`);
    }
  }

  for (const fp of c.forbiddenPromises ?? []) {
    if (actual.promises.some((x) => has(x.text, fp.match))) v.push(`forbidden promise present: "${fp.match}"`);
  }

  for (const rp of c.requiredPeople ?? []) {
    const person = actual.people.find((x) => has(x.name ?? '', rp.name));
    if (!person) { v.push(`missing required person: "${rp.name}"`); continue; }
    if (rp.decisionRole && person.decision_role !== rp.decisionRole) {
      v.push(`person "${rp.name}" decision_role must be ${rp.decisionRole}, got ${person.decision_role}`);
    }
  }

  // Forbidden entities: scan every text-bearing field the entity could leak into.
  const blob = [
    ...actual.promises.map((p) => `${p.text} ${p.due_raw ?? ''}`),
    ...actual.people.map((p) => `${p.name ?? ''} ${p.role ?? ''} ${p.notes ?? ''}`),
    ...actual.key_dates.map((d) => `${d.description} ${d.date_raw ?? ''}`),
    ...actual.personal_facts.map((f) => `${f.subject} ${f.fact}`),
  ].join(' | ');
  for (const e of c.forbiddenEntities ?? []) {
    if (has(blob, e)) v.push(`forbidden entity leaked into the record: "${e}"`);
  }

  for (const rd of c.requiredDates ?? []) {
    const kd = actual.key_dates.find((d) => has(d.description, rd.match));
    if (!kd) { v.push(`missing required date: "${rd.match}"`); continue; }
    if (rd.year === null && kd.date !== null) {
      v.push(`date "${rd.match}" must be null (guessed ${kd.date})`);
    } else if (typeof rd.year === 'number' && yearOf(kd.date) !== rd.year) {
      v.push(`date "${rd.match}" must resolve to ${rd.year}, got ${kd.date ?? 'null'}`);
    }
  }

  // mustNotMerge uses EXACT (case-insensitive, trimmed) name equality, never substring: the pair is
  // deliberately near-identical (Sara / Sarah), and "Sarah".includes("sara") is true — substring
  // matching would report a merge as passing. A merge collapses the pair to one name, so requiring
  // BOTH exact names present detects it.
  const nameEq = (n: string | null, want: string) => (n ?? '').trim().toLowerCase() === want.trim().toLowerCase();
  for (const [a, b] of c.mustNotMerge ?? []) {
    const hasA = actual.people.some((p) => nameEq(p.name, a));
    const hasB = actual.people.some((p) => nameEq(p.name, b));
    if (!hasA || !hasB) v.push(`must-not-merge pair not both present as distinct people: "${a}" / "${b}"`);
  }

  return { id: c.id, violations: v, passed: v.length === 0 };
}
