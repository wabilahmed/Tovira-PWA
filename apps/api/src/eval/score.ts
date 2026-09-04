import type { Extraction, ExtractedPromise, ExtractedPerson, Requirement } from '../services/extraction/types.js';

/** Per-note scoring counts for the quality gate. */
export interface NoteScore {
  promises: { tp: number; fp: number; fn: number };
  people: { tp: number; fp: number; fn: number };
  requirements: { tp: number; fp: number; fn: number }; // REQ-CERT: the new `requirements` field
  dates: { resolvedExpected: number; expectedResolvable: number };
  fabricatedPromises: number; // predicted promises with no matching expected
  guessedDates: number; // predicted a specific date where the truth is null
  mergedPeople: number; // two people who must stay distinct were collapsed into one
  falseCertainties: number; // a promise the key marks low-confidence returned as high — an unconfirmed guess presented as a fact
  leakedValues: number; // REDACT-5: a forbidden sensitive value/fragment appeared in the model output
  nullNamedPeople: number; // Rule 5: a person emitted with a null/empty name (a role-only reference) — never allowed
  // REQ-CERT diagnostics (the requirements regression risks, tracked distinctly):
  requirementFalsePositives: number; // a concern/complaint/question/speculation emitted AS a requirement — the flagged concern↔requirement leak. Alias of requirements.fp, surfaced by name.
  requirementDateErrors: number; // a MATCHED requirement whose stated_on ≠ the key's (Rule 8 / DATE-REF: stated_on must be the note's reference date, not today's real clock)
  requirementConfInflation: number; // a MATCHED requirement the key marks low returned as high — a conditional/vague need presented as firm (Rule 8 false certainty)
}

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2),
  );
}

function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function promiseMatches(p: ExtractedPromise, e: ExtractedPromise): boolean {
  return p.owner === e.owner && jaccard(p.text, e.text) >= 0.34;
}

function personMatches(p: ExtractedPerson, e: ExtractedPerson): boolean {
  return !!e.name && (p.name ?? '').trim().toLowerCase() === e.name.trim().toLowerCase();
}

/** A predicted requirement matches an expected one on the meaning of the need. We compare
 *  the verbatim `requirement_raw` (the phrase the rule pins) OR the normalised `text`, taking
 *  the stronger of the two — the model may phrase `text` differently but should quote the same
 *  raw span. 0.34 mirrors the promise threshold. */
function requirementMatches(p: Requirement, e: Requirement): boolean {
  return Math.max(jaccard(p.requirement_raw, e.requirement_raw), jaccard(p.text, e.text)) >= 0.34;
}

/** Score one predicted extraction against the known-correct expected. `mustNotMerge`
 *  lists name pairs that must appear as two DISTINCT people (never collapsed). */
export function scoreNote(
  expected: Extraction,
  actual: Extraction | null,
  mustNotMerge: Array<[string, string]> = [],
  forbidden: string[] = [],
): NoteScore {
  const score: NoteScore = {
    promises: { tp: 0, fp: 0, fn: 0 },
    people: { tp: 0, fp: 0, fn: 0 },
    requirements: { tp: 0, fp: 0, fn: 0 },
    dates: { resolvedExpected: 0, expectedResolvable: 0 },
    fabricatedPromises: 0,
    guessedDates: 0,
    mergedPeople: 0,
    falseCertainties: 0,
    leakedValues: 0,
    nullNamedPeople: 0,
    requirementFalsePositives: 0,
    requirementDateErrors: 0,
    requirementConfInflation: 0,
  };

  const predicted = actual ?? {
    summary: '',
    promises: [],
    people: [],
    personal_facts: [],
    key_dates: [],
    concerns: [],
    next_steps: [],
    requirements: [],
    meeting: null,
  };

  // Promises.
  const matchedExpected = new Set<number>();
  for (const p of predicted.promises) {
    const idx = expected.promises.findIndex((e, i) => !matchedExpected.has(i) && promiseMatches(p, e));
    if (idx >= 0) {
      matchedExpected.add(idx);
      score.promises.tp += 1;
      // Guessed date: truth says null but the model produced a specific date.
      if (expected.promises[idx]!.due_date === null && p.due_date !== null) score.guessedDates += 1;
      // False certainty: truth is uncertain (low) but the model asserted it high —
      // presenting an unconfirmed guess as a fact (spec principle, now gate-enforced).
      if (expected.promises[idx]!.confidence === 'low' && p.confidence === 'high') score.falseCertainties += 1;
    } else {
      score.promises.fp += 1;
      score.fabricatedPromises += 1;
      // A fabricated promise's date is part of the fabrication (scored by the aggregate
      // fabrication bar), NOT a separate guessed date. Double-counting it here would let a
      // dated phantom re-fail the per-run-zero guessed bar, undoing the ruling that
      // fabrication is aggregate-only. guessedDates is reserved for MATCHED promises.
    }
  }
  score.promises.fn = expected.promises.length - matchedExpected.size;

  // Dates resolvable: expected promises/key_dates whose date should resolve to a value.
  const expectedDated = [
    ...expected.promises.map((p) => ({ truth: p.due_date, hasPhrase: p.due_raw !== null })),
    ...expected.key_dates.map((d) => ({ truth: d.date, hasPhrase: d.date_raw !== null })),
  ];
  for (const d of expectedDated) {
    if (d.truth !== null) score.dates.expectedResolvable += 1;
  }
  // Count key_date guessed dates too (truth null but predicted a value).
  for (const pd of predicted.key_dates) {
    const match = expected.key_dates.find((e) => jaccard(pd.description, e.description) >= 0.34);
    if (match && match.date === null && pd.date !== null) score.guessedDates += 1;
  }

  // People.
  const matchedPeople = new Set<number>();
  for (const p of predicted.people) {
    const idx = expected.people.findIndex((e, i) => !matchedPeople.has(i) && personMatches(p, e));
    if (idx >= 0) {
      matchedPeople.add(idx);
      score.people.tp += 1;
    } else {
      score.people.fp += 1;
    }
  }
  score.people.fn = expected.people.length - matchedPeople.size;

  // Rule 5: a person with a null/empty name is a role-only reference — never allowed.
  score.nullNamedPeople = predicted.people.filter((p) => (p.name ?? '').trim() === '').length;

  // Merges: each pair that must stay distinct is a violation unless BOTH names
  // appear as separate predicted people (collapsing two mentions into one fails).
  const hasName = (name: string): boolean => {
    const n = name.trim().toLowerCase();
    return predicted.people.some((p) => (p.name ?? '').trim().toLowerCase() === n);
  };
  for (const [a, b] of mustNotMerge) {
    if (!(hasName(a) && hasName(b))) score.mergedPeople += 1;
  }

  // Requirements (REQ-CERT). tp/fp/fn drive precision/recall; fp is the concern↔requirement leak
  // (a complaint, question or rep speculation emitted as a stated need) — the flagged regression.
  const expectedReqs = expected.requirements ?? [];
  const predictedReqs = predicted.requirements ?? [];
  const matchedReqs = new Set<number>();
  for (const p of predictedReqs) {
    const idx = expectedReqs.findIndex((e, i) => !matchedReqs.has(i) && requirementMatches(p, e));
    if (idx >= 0) {
      matchedReqs.add(idx);
      score.requirements.tp += 1;
      const e = expectedReqs[idx]!;
      // Rule 8: stated_on must be the note's reference date. A matched requirement with the wrong
      // stated_on is the DATE-REF regression the 8th (import-dated) fixture exists to catch.
      if ((p.stated_on ?? null) !== (e.stated_on ?? null)) score.requirementDateErrors += 1;
      // A conditional/vague need (key = low) returned high is a requirement false certainty.
      if (e.confidence === 'low' && p.confidence === 'high') score.requirementConfInflation += 1;
    } else {
      score.requirements.fp += 1;
    }
  }
  score.requirements.fn = expectedReqs.length - matchedReqs.size;
  score.requirementFalsePositives = score.requirements.fp;

  if (forbidden.length) {
    const blob = JSON.stringify(predicted).toLowerCase();
    for (const f of forbidden) if (blob.includes(f.toLowerCase())) score.leakedValues += 1;
  }

  return score;
}

export interface FieldMetrics {
  precision: number;
  recall: number;
}

function metrics(tp: number, fp: number, fn: number): FieldMetrics {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  return { precision, recall };
}

export interface AggregateMetrics {
  promises: FieldMetrics;
  people: FieldMetrics;
  requirements: FieldMetrics;
  fabricatedPromises: number;
  guessedDates: number;
  mergedPeople: number;
  falseCertainties: number;
  leakedValues: number;
  nullNamedPeople: number;
  requirementFalsePositives: number;
  requirementDateErrors: number;
  requirementConfInflation: number;
  notes: number;
}

export function aggregate(scores: NoteScore[]): AggregateMetrics {
  const sum = (pick: (s: NoteScore) => number) => scores.reduce((a, s) => a + pick(s), 0);
  return {
    promises: metrics(sum((s) => s.promises.tp), sum((s) => s.promises.fp), sum((s) => s.promises.fn)),
    people: metrics(sum((s) => s.people.tp), sum((s) => s.people.fp), sum((s) => s.people.fn)),
    requirements: metrics(sum((s) => s.requirements.tp), sum((s) => s.requirements.fp), sum((s) => s.requirements.fn)),
    fabricatedPromises: sum((s) => s.fabricatedPromises),
    guessedDates: sum((s) => s.guessedDates),
    mergedPeople: sum((s) => s.mergedPeople),
    falseCertainties: sum((s) => s.falseCertainties),
    leakedValues: sum((s) => s.leakedValues),
    nullNamedPeople: sum((s) => s.nullNamedPeople),
    requirementFalsePositives: sum((s) => s.requirementFalsePositives),
    requirementDateErrors: sum((s) => s.requirementDateErrors),
    requirementConfInflation: sum((s) => s.requirementConfInflation),
    notes: scores.length,
  };
}
