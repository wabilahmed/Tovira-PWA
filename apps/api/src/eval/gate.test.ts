import { describe, it, expect } from 'vitest';
import { runGate, runEval } from './gate.js';
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
    ? { ...n.expected, promises: [{ ...n.expected.promises[0]!, due_date: '2026-01-05' }] }
    : n.expected,
);

const dropping = scriptedModel((n) => ({ ...n.expected, promises: [] }));

describe('[P1-9] extraction quality gate', () => {
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

  // Regression guard: dropping promises tanks recall and fails the gate.
  it('FAILS when recall drops below the threshold', async () => {
    const result = await runGate(dropping, 'dropping-stub');
    expect(result.passed).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/recall/i);
  });

  it('records the model decision (which model, pass/fail)', async () => {
    const result = await runGate(perfect, 'haiku-4-5');
    expect(result.model).toBe('haiku-4-5');
    expect(typeof result.passed).toBe('boolean');
  });
});
