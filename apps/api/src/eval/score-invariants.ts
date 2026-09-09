import type { Extraction, DecisionRole } from '../services/extraction/types.js';

/**
 * [GATE-IMPORT-SIZE] Invariant scoring for import-sized fixtures.
 *
 * Full-output ground truth is not honestly achievable for a rich multi-message transcript (exact-match
 * scoring manufactures false "fabrications" from legitimate rewording / contingent-promise variance —
 * proven by OMAR-FAB attribution), so import fixtures certify as an INVARIANT CONTRACT: the planted
 * anchors must be found, the trust rules must hold, nothing wrong is asserted.
 *
 * Violations split into two policy classes (owner-ruled 2026-09-09):
 *   - WRONGNESS (commission — the system asserted something WRONG): a guessed date on a planted null,
 *     a wrong-year date, a forbidden/retracted promise present, a forbidden entity leaked, merged
 *     people. Gated PER-RUN, zero tolerance.
 *   - RECALL MISS (omission — a right fact is missing, or a present person's role is off): reported,
 *     NOT gated (a drift signal watched beside its baseline). General fabrication is governed by the
 *     single-note gate's AGGREGATE bar (≤1.2%), exactly as before — an import fixture does not add a
 *     per-run fabrication gate.
 *
 * [flag] classification choices for the owner: a WRONG-YEAR date is treated as WRONGNESS (a wrong date
 * is a wrong fact, same family as a guessed date); a WRONG decision_role is treated as a RECALL MISS
 * (a softer attribute miss — roles are governed by the single-note gate's aggregate people-precision,
 * not per-run zero). Tell me to move either.
 *
 * score-invariants.test.ts proves both directions: a WRONGNESS case gates (passed=false); a RECALL
 * miss is detected and reported but does NOT gate (passed=true, anchorsFound drops); a clean result
 * passes with full recall. A metric that can't fail — or can't pass a legitimately-worded answer —
 * certifies nothing.
 */
export interface InvariantContract {
  id: string;
  requiredPromises?: Array<{ match: string; dueYear?: number | null }>;
  forbiddenPromises?: Array<{ match: string }>;
  requiredPeople?: Array<{ name: string; decisionRole?: DecisionRole }>;
  forbiddenEntities?: string[];
  requiredDates?: Array<{ match: string; year: number | null }>;
  mustNotMerge?: Array<[string, string]>;
}

export interface InvariantResult {
  id: string;
  /** Commission errors — gated per-run, zero tolerance. */
  wrongness: string[];
  /** Omission errors (missing anchor, off role) — reported, not gated. */
  recallMisses: string[];
  /** wrongness ∪ recallMisses, for full reporting. */
  violations: string[];
  /** The GATE: no wrongness. Recall is reported separately, never gates here. */
  passed: boolean;
  anchorsRequired: number;
  anchorsFound: number;
}

const has = (hay: string, needle: string): boolean => hay.toLowerCase().includes(needle.toLowerCase());
const yearOf = (iso: string | null): number | null => (iso ? Number(iso.slice(0, 4)) : null);

export function scoreInvariants(c: InvariantContract, actual: Extraction): InvariantResult {
  const wrong: string[] = [];   // commission → gates
  const misses: string[] = [];  // omission → reported
  let anchorsFound = 0;
  const anchorsRequired = (c.requiredPromises ?? []).length + (c.requiredPeople ?? []).length + (c.requiredDates ?? []).length;

  for (const rp of c.requiredPromises ?? []) {
    // Match text AND due_raw: the engine legitimately splits a commitment across fields (OMAR-DIAG).
    const p = actual.promises.find((x) => has(`${x.text} ${x.due_raw ?? ''}`, rp.match));
    if (!p) { misses.push(`missing required promise: "${rp.match}"`); continue; }
    anchorsFound += 1;
    if (rp.dueYear === null && p.due_date !== null) {
      wrong.push(`promise "${rp.match}" must have NO date (guessed ${p.due_date})`);
    } else if (typeof rp.dueYear === 'number' && yearOf(p.due_date) !== rp.dueYear) {
      wrong.push(`promise "${rp.match}" date must resolve to ${rp.dueYear}, got ${p.due_date ?? 'null'}`);
    }
  }

  for (const fp of c.forbiddenPromises ?? []) {
    if (actual.promises.some((x) => has(x.text, fp.match))) wrong.push(`forbidden promise present: "${fp.match}"`);
  }

  for (const rp of c.requiredPeople ?? []) {
    const person = actual.people.find((x) => has(x.name ?? '', rp.name));
    if (!person) { misses.push(`missing required person: "${rp.name}"`); continue; }
    anchorsFound += 1;
    if (rp.decisionRole && person.decision_role !== rp.decisionRole) {
      misses.push(`person "${rp.name}" decision_role is ${person.decision_role}, expected ${rp.decisionRole}`); // reported, not gated
    }
  }

  const blob = [
    ...actual.promises.map((p) => `${p.text} ${p.due_raw ?? ''}`),
    ...actual.people.map((p) => `${p.name ?? ''} ${p.role ?? ''} ${p.notes ?? ''}`),
    ...actual.key_dates.map((d) => `${d.description} ${d.date_raw ?? ''}`),
    ...actual.personal_facts.map((f) => `${f.subject} ${f.fact}`),
  ].join(' | ');
  for (const e of c.forbiddenEntities ?? []) {
    if (has(blob, e)) wrong.push(`forbidden entity leaked into the record: "${e}"`);
  }

  for (const rd of c.requiredDates ?? []) {
    const kd = actual.key_dates.find((d) => has(d.description, rd.match));
    if (!kd) { misses.push(`missing required date: "${rd.match}"`); continue; }
    anchorsFound += 1;
    if (rd.year === null && kd.date !== null) {
      wrong.push(`date "${rd.match}" must be null (guessed ${kd.date})`);
    } else if (typeof rd.year === 'number' && yearOf(kd.date) !== rd.year) {
      wrong.push(`date "${rd.match}" must resolve to ${rd.year}, got ${kd.date ?? 'null'}`);
    }
  }

  // Exact (not substring) name equality — the pair is deliberately near-identical (Sara/Sarah), where
  // substring matching would report a merge as passing.
  const nameEq = (n: string | null, want: string) => (n ?? '').trim().toLowerCase() === want.trim().toLowerCase();
  for (const [a, b] of c.mustNotMerge ?? []) {
    const hasA = actual.people.some((p) => nameEq(p.name, a));
    const hasB = actual.people.some((p) => nameEq(p.name, b));
    // A MERGE is a COLLAPSE — exactly one of the pair survives (the two mentions folded into one). That
    // is WRONGNESS (a wrong fact asserted). Both ABSENT is not a merge, it's recall (both omitted) —
    // reported, not gated. Both present is correct.
    if (hasA !== hasB) wrong.push(`must-not-merge pair collapsed — only one of "${a}" / "${b}" present (merged)`);
    else if (!hasA && !hasB) misses.push(`must-not-merge pair "${a}" / "${b}" both absent (recall, not a merge)`);
  }

  return { id: c.id, wrongness: wrong, recallMisses: misses, violations: [...wrong, ...misses], passed: wrong.length === 0, anchorsRequired, anchorsFound };
}
