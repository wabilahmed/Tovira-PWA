import { describe, it, expect } from 'vitest';
import { runGate, runEval, softGate, extractForEval, evaluateGate, GATE_HARD } from './gate.js';
import type { AggregateMetrics } from './score.js';
import { EVAL_NOTES, type EvalNote } from './eval-set.js';
import type { Extraction } from '../services/extraction/types.js';
import type { ModelClient } from '../ports/model.js';

/** A model scripted to return `fn(note)` for whichever eval note it's given. */
function scriptedModel(fn: (note: EvalNote) => Extraction): ModelClient {
  return {
    complete: async (req) => {
      const content = req.messages[req.messages.length - 1]!.content;
      const note = EVAL_NOTES.find((n) => content.includes(n.note));
      if (!note) return { text: '{}' };
      return { text: JSON.stringify(fn(note)) };
    },
  };
}

const perfect = scriptedModel((n) => n.expected);

const fabricating = scriptedModel((n) =>
  n.id === 'no-commitment-catchup'
    ? { ...n.expected, promises: [{ text: 'follow up with pricing', owner: 'rep', due_date: null, due_raw: null, confidence: 'high' }] }
    : n.expected,
);

const guessing = scriptedModel((n) =>
  n.id === 'unresolved-vague-date'
    ? { ...n.expected, promises: [{ ...n.expected.promises[0]!, due_date: '2026-08-01' }] }
    : n.expected,
);

const dropping = scriptedModel((n) => ({ ...n.expected, promises: [] }));

const cleanMetrics: AggregateMetrics = {
  promises: { precision: 1, recall: 1 },
  people: { precision: 1, recall: 1 },
  fabricatedPromises: 0,
  guessedDates: 0,
  mergedPeople: 0,
  falseCertainties: 0,
  leakedValues: 0,
  notes: 1,
};

// GATE-SELFTEST: a metric that cannot fail the gate is not a metric. `leakedValues` was
// once dark (threaded but unused) — the gate reported a bar it wasn't enforcing. This
// proves every HARD metric, when violated by a synthetic result, actually fails the gate.
// Pure evaluateGate over synthetic metrics — zero model cost, runs in CI.
describe('[GATE-SELFTEST] every hard metric can fail the gate', () => {
  const HARD_METRICS: Array<{ field: keyof AggregateMetrics; reason: RegExp }> = [
    { field: 'fabricatedPromises', reason: /fabricat/i },
    { field: 'guessedDates', reason: /guessed/i },
    { field: 'mergedPeople', reason: /merged/i },
    { field: 'falseCertainties', reason: /certaint|confiden/i },
    { field: 'leakedValues', reason: /leak/i },
  ];

  it('PASSES a fully clean synthetic result (control)', () => {
    expect(evaluateGate(cleanMetrics, 'clean').passed).toBe(true);
  });

  for (const { field, reason } of HARD_METRICS) {
    it(`HARD-FAILS when ${field} is violated (=1), and names it`, () => {
      const r = evaluateGate({ ...cleanMetrics, [field]: 1 }, `violate-${field}`);
      expect(r.passed, `${field}=1 must fail the gate — a metric that cannot fail is not a metric`).toBe(false);
      expect(r.reasons.join(' ')).toMatch(reason);
    });
  }

  it('covers every GATE_HARD threshold (no hard rule left unexercised)', () => {
    // If someone adds a GATE_HARD.maxX, this forces a matching self-test above.
    const covered = new Set(HARD_METRICS.map((m) => m.field as string));
    const hardFields = Object.keys(GATE_HARD).map((k) => k.replace(/^max/, '').replace(/^./, (c) => c.toLowerCase()));
    for (const f of hardFields) expect(covered, `GATE_HARD.${f} has no GATE-SELFTEST — add one`).toContain(f);
  });
});

describe('[P1-9] extraction quality gate', () => {
  // v0.6: a promise the answer key marks low-confidence, returned high, is a false
  // certainty — the hard gate blocks it (never present an unconfirmed guess as a fact).
  it('HARD-FAILS on a false certainty (low expected, returned high)', () => {
    const r = evaluateGate({ ...cleanMetrics, falseCertainties: 1 }, 'overconfident');
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/certaint|confiden/i);
  });

  it('PASSES clean metrics with zero false certainties', () => {
    expect(evaluateGate(cleanMetrics, 'clean').passed).toBe(true);
  });

  it('produces precision/recall numbers per field', async () => {
    const metrics = await runEval(perfect, 'perfect-stub');
    expect(metrics.promises).toHaveProperty('precision');
    expect(metrics.promises).toHaveProperty('recall');
    expect(metrics.people).toHaveProperty('recall');
  });

  it('PASSES for a model that matches the eval set (no fabrication, no guesses)', async () => {
    const result = await runGate(perfect, 'perfect-stub');
    expect(result.passed).toBe(true);
    expect(result.metrics.fabricatedPromises).toBe(0);
    expect(result.metrics.guessedDates).toBe(0);
  });

  // NEGATIVE: any fabricated promise fails the gate (flagged by the harness).
  it('FAILS when the model fabricates a promise', async () => {
    const result = await runGate(fabricating, 'fabricating-stub');
    expect(result.passed).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/fabricat/i);
  });

  // NEGATIVE: any guessed date fails the gate.
  it('FAILS when the model guesses a date that should be null', async () => {
    const result = await runGate(guessing, 'guessing-stub');
    expect(result.passed).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/guessed/i);
  });

  // Recall is now a SOFT bar on the aggregate (not per-run hard): dropping
  // promises tanks recall and fails the soft gate.
  it('the soft gate flags low recall on the aggregate', async () => {
    const metrics = await runEval(dropping, 'dropping-stub');
    const result = softGate(metrics, 'dropping-stub');
    expect(result.passed).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/recall/i);
  });

  // HARD: merging two people who must stay distinct fails the per-run gate.
  it('FAILS (hard) when two distinct people are merged into one', async () => {
    const merging = scriptedModel((n) => (n.mustNotMerge?.length ? { ...n.expected, people: n.expected.people.slice(0, 1) } : n.expected));
    const result = await runGate(merging, 'merging-stub');
    expect(result.passed).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/merged/i);
    expect(result.metrics.mergedPeople).toBeGreaterThan(0);
  });

  // Date stability: the gate injects each note's PINNED today, never the real
  // clock — so results never drift with the calendar.
  it("injects the note's pinned today into the model message (never new Date())", async () => {
    let seenToday = '';
    const capture: ModelClient = {
      complete: async (req) => {
        seenToday = /today[^0-9]*(\d{4}-\d{2}-\d{2})/i.exec(req.messages[0]!.content)?.[1] ?? '';
        return { text: '{}' };
      },
    };
    const note = EVAL_NOTES.find((n) => n.today === '2026-08-01')!;
    await extractForEval(capture, note);
    expect(seenToday).toBe(note.today);
  });

  it('records the model decision (which model, pass/fail)', async () => {
    const result = await runGate(perfect, 'haiku-4-5');
    expect(result.model).toBe('haiku-4-5');
    expect(typeof result.passed).toBe('boolean');
  });
});
