import { describe, it, expect } from 'vitest';
import { EVAL_NOTES } from './eval-set.js';

// P1-9: multilingual is a LOCKED requirement — the eval set must include
// code-switched Arabic–English–Hindi–Urdu notes, proven here, not assumed.
// This guards against a future edit silently dropping them.
describe('eval set — multilingual coverage (P1-9)', () => {
  const multilingual = EVAL_NOTES.filter((n) => n.multilingual);

  it('includes code-switched notes', () => {
    expect(multilingual.length).toBeGreaterThanOrEqual(3);
  });

  it('the code-switched notes actually mix scripts (contain non-Latin characters)', () => {
    const nonLatin = /\p{Script=Arabic}|\p{Script=Devanagari}/u; // Arabic/Urdu + Hindi
    for (const n of multilingual) {
      expect(n.note).toMatch(nonLatin);
      expect(n.note).toMatch(/[a-zA-Z]/); // and Latin — i.e. genuinely code-switched
    }
  });

  it('every eval note has a well-formed expected extraction', () => {
    for (const n of EVAL_NOTES) {
      expect(typeof n.expected.summary).toBe('string');
      expect(Array.isArray(n.expected.promises)).toBe(true);
      for (const p of n.expected.promises) {
        expect(['rep', 'client']).toContain(p.owner);
        expect(['high', 'low']).toContain(p.confidence);
        expect(p.due_date === null || typeof p.due_date === 'string').toBe(true);
      }
    }
  });

  // The trust rule holds in the multilingual set too: at least one code-switched
  // note has an UNRESOLVABLE date that must stay null (no guessing across languages).
  it('a code-switched note exercises the no-guessed-date rule', () => {
    const hasNullDatePromise = multilingual.some((n) =>
      n.expected.promises.some((p) => p.due_date === null && p.due_raw !== null),
    );
    expect(hasNullDatePromise).toBe(true);
  });
});
