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

  // v0.5: people-recall needs enough named instances to be a signal, not a coin
  // flip — the multilingual subset must carry ≥10 named-people expectations.
  it('carries at least 10 named-people instances across code-switched notes', () => {
    const named = multilingual.flatMap((n) => n.expected.people).filter((p) => (p.name ?? '').trim().length > 0);
    expect(named.length).toBeGreaterThanOrEqual(10);
  });

  // v0.5: role-only regression — notes referencing an unnamed role expect NO
  // person, so a null-named "person" can be caught.
  it('includes role-only notes whose expected people list is empty', () => {
    const roleOnly = EVAL_NOTES.filter((n) => n.id.startsWith('role-only-'));
    expect(roleOnly.length).toBeGreaterThanOrEqual(2);
    for (const n of roleOnly) expect(n.expected.people).toHaveLength(0);
  });

  // Every expected person carries a non-empty name — the eval never asserts a
  // null-named person as ground truth (that is exactly what v0.5 forbids).
  it('no expected person has a null or empty name', () => {
    for (const n of EVAL_NOTES) for (const p of n.expected.people) expect((p.name ?? '').trim().length).toBeGreaterThan(0);
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
