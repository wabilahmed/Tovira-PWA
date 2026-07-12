import type { Extraction, ExtractedPromise, ExtractedPerson } from '../services/extraction/types.js';

/** Per-note scoring counts for the quality gate. */
export interface NoteScore {
  promises: { tp: number; fp: number; fn: number };
  people: { tp: number; fp: number; fn: number };
  dates: { resolvedExpected: number; expectedResolvable: number };
  fabricatedPromises: number; // predicted promises with no matching expected
  guessedDates: number; // predicted a specific date where the truth is null
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

/** Score one predicted extraction against the known-correct expected. */
export function scoreNote(expected: Extraction, actual: Extraction | null): NoteScore {
  const score: NoteScore = {
    promises: { tp: 0, fp: 0, fn: 0 },
    people: { tp: 0, fp: 0, fn: 0 },
    dates: { resolvedExpected: 0, expectedResolvable: 0 },
    fabricatedPromises: 0,
    guessedDates: 0,
  };

  const predicted = actual ?? {
    summary: '',
    promises: [],
    people: [],
    personal_facts: [],
    key_dates: [],
    concerns: [],
    next_steps: [],
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
    } else {
      score.promises.fp += 1;
      score.fabricatedPromises += 1;
      if (p.due_date !== null) score.guessedDates += 1; // fabricated promise with a date
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
  fabricatedPromises: number;
  guessedDates: number;
  notes: number;
}

export function aggregate(scores: NoteScore[]): AggregateMetrics {
  const sum = (pick: (s: NoteScore) => number) => scores.reduce((a, s) => a + pick(s), 0);
  return {
    promises: metrics(sum((s) => s.promises.tp), sum((s) => s.promises.fp), sum((s) => s.promises.fn)),
    people: metrics(sum((s) => s.people.tp), sum((s) => s.people.fp), sum((s) => s.people.fn)),
    fabricatedPromises: sum((s) => s.fabricatedPromises),
    guessedDates: sum((s) => s.guessedDates),
    notes: scores.length,
  };
}
