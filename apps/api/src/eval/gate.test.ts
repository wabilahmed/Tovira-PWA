import { describe, it, expect } from 'vitest';
import { runGate, runEval, softGate, extractForEval, evaluateGate, fabricationGate, tier1Residual, tier2Gate, GATE_HARD, GATE_FAB, GATE_TIER2 } from './gate.js';
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
  nullNamedPeople: 0,
  notes: 1,
};

// GATE-SELFTEST: a metric that cannot fail the gate is not a metric. `leakedValues` was
// once dark (threaded but unused) — the gate reported a bar it wasn't enforcing. This
// proves every HARD metric, when violated by a synthetic result, actually fails the gate.
// Pure evaluateGate over synthetic metrics — zero model cost, runs in CI.
describe('[GATE-SELFTEST] every hard metric can fail the gate', () => {
  // NOT here (moved to aggregate bars, tested separately): fabricationGate, and Tier-2
  // leakage (tier2Gate) — both stochastic model layers. leakedValues is no longer a per-run
  // HARD metric: Tier-1 is deterministic (tier1Residual), Tier-2 is the aggregate bar.
  const HARD_METRICS: Array<{ field: keyof AggregateMetrics; reason: RegExp }> = [
    { field: 'guessedDates', reason: /guessed/i },
    { field: 'mergedPeople', reason: /merged/i },
    { field: 'falseCertainties', reason: /certaint|confiden/i },
    { field: 'nullNamedPeople', reason: /no name|role-only|Rule 5/i },
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

// The aggregate fabrication bar (owner ruling): fabrication has a demonstrated floor, so it
// is a rate ceiling over N, not per-run zero. Still a real bar — it must be able to fail.
describe('[GATE-SELFTEST] aggregate fabrication bar', () => {
  const bigN = GATE_FAB.minExtractions; // enough extractions to certify

  it('CERTIFIES a rate at/under the ceiling over a sufficient sample', () => {
    // measured ~0.22%: 1 fabrication in minExtractions is under the 0.5% ceiling.
    const r = fabricationGate({ ...cleanMetrics, fabricatedPromises: 1, notes: bigN }, 'at-rate');
    expect(r.passed).toBe(true);
    expect(r.provisional).toBe(false);
    expect(r.ratePct).toBeLessThanOrEqual(GATE_FAB.maxRatePct);
  });

  it('FAILS when the aggregate rate exceeds the ceiling', () => {
    // 2% fabrication rate — a real regression, well over 0.5%.
    const r = fabricationGate({ ...cleanMetrics, fabricatedPromises: Math.ceil(bigN * 0.02), notes: bigN }, 'over-rate');
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/fabrication rate/i);
  });

  it('marks a below-minimum sample PROVISIONAL (never a certification)', () => {
    const r = fabricationGate({ ...cleanMetrics, fabricatedPromises: 0, notes: 96 }, 'small');
    expect(r.provisional).toBe(true);
    expect(r.extractions).toBe(96);
  });
});

// Leakage is TWO guarantees. Tier-1 is deterministic (ingest regex) and must be zero without
// the model; Tier-2 is a stochastic model rule and gets an aggregate ceiling — never one number.
describe('[GATE-SELFTEST] leakage — Tier-1 deterministic, Tier-2 aggregate', () => {
  it('TIER-1: redact.ts leaves no residual pattern in any eval fixture (idempotent, zero)', () => {
    expect(tier1Residual(), 'redact.ts must strip every Tier-1 value from every fixture').toEqual([]);
  });

  it('TIER-2: an aggregate rate over the ceiling FAILS', () => {
    const over = Math.ceil(GATE_TIER2.minExposures * (GATE_TIER2.maxRatePct / 100)) + 2;
    const r = tier2Gate({ ...cleanMetrics, leakedValues: over }, GATE_TIER2.minExposures, 'over');
    expect(r.passed).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/tier-2 leakage rate/i);
  });

  it('TIER-2: a rate under the ceiling over enough exposures certifies', () => {
    const r = tier2Gate({ ...cleanMetrics, leakedValues: 0 }, GATE_TIER2.minExposures, 'clean');
    expect(r.passed).toBe(true);
    expect(r.provisional).toBe(false);
  });

  it('TIER-2: too few exposures is PROVISIONAL, never a certification', () => {
    const r = tier2Gate({ ...cleanMetrics, leakedValues: 0 }, GATE_TIER2.minExposures - 1, 'small');
    expect(r.provisional).toBe(true);
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

  // Fabrication is now an AGGREGATE bar, not per-run (owner ruling): a single fabricated
  // promise no longer fails a per-run gate — it counts toward the rate. runEval still
  // measures it; a rate over the ceiling (across a sufficient sample) fails fabricationGate.
  it('counts a fabricated promise into the aggregate rate (not a per-run hard fail)', async () => {
    const metrics = await runEval(fabricating, 'fabricating-stub');
    expect(metrics.fabricatedPromises).toBeGreaterThan(0); // still measured
    expect(evaluateGate(metrics, 'fabricating-stub').passed).toBe(true); // no longer a per-run hard fail
    // Scaled to a realistic per-run rate over a big sample, a persistent fabricator breaches the ceiling.
    const perRunRate = metrics.fabricatedPromises / metrics.notes;
    const big = fabricationGate({ ...metrics, fabricatedPromises: Math.round(perRunRate * GATE_FAB.minExtractions), notes: GATE_FAB.minExtractions }, 'fabricating-stub');
    expect(big.passed).toBe(false);
    expect(big.reasons.join(' ')).toMatch(/fabrication rate/i);
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

  // Leakage bar tests the PRODUCTION pipeline (owner ruling): notes are ingest-redacted
  // before extraction, so a Tier-1 value never reaches the model — the guarantee we ship,
  // not the model's stochastic willingness to decline it. extractForEval must redact first.
  it('redacts Tier-1 at ingest before the model sees it (prod pipeline)', async () => {
    let seen = '';
    const capture: ModelClient = {
      complete: async (req) => { seen = req.messages[req.messages.length - 1]!.content; return { text: '{}' }; },
    };
    const EMPTY: Extraction = { summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null };
    const note: EvalNote = { id: 'redact-pipe', today: '2026-09-02', clientName: 'C', source: 'paste', note: 'pay to AE070331234567890123456 today', expected: EMPTY };
    await extractForEval(capture, note);
    expect(seen).not.toContain('AE070331234567890123456'); // the model never sees the raw value
    expect(seen).toContain('[IBAN redacted]');
  });

  it('records the model decision (which model, pass/fail)', async () => {
    const result = await runGate(perfect, 'haiku-4-5');
    expect(result.model).toBe('haiku-4-5');
    expect(typeof result.passed).toBe('boolean');
  });
});
