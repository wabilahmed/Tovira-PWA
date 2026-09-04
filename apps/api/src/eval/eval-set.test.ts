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

// REQ-CERT (2026-09-04): the certified `requirements` fixtures self-enforce their own point.
describe('eval set — requirements coverage (REQ-CERT)', () => {
  const req = EVAL_NOTES.filter((n) => n.id.startsWith('req-'));

  it('includes the certified requirements fixtures', () => {
    expect(req.length).toBeGreaterThanOrEqual(8);
  });

  // The flagged regression guard: at least one fixture proves a concern is NOT a requirement
  // (concerns non-empty, requirements empty).
  it('carries a concern-not-requirement boundary fixture', () => {
    const boundary = req.filter((n) => n.expected.concerns.length > 0 && (n.expected.requirements ?? []).length === 0);
    expect(boundary.length).toBeGreaterThanOrEqual(1);
  });

  // JC1: an import-dated fixture whose stated_on tracks the message date, NOT today — the only
  // way this set can catch stated_on regressing to the reference clock (the DATE-REF class).
  it('proves stated_on tracks the reference date, not today (import fixture)', () => {
    const imported = req.filter((n) => n.importMessageDate);
    expect(imported.length).toBeGreaterThanOrEqual(1);
    for (const n of imported) {
      const reqs = n.expected.requirements ?? [];
      expect(reqs.length).toBeGreaterThanOrEqual(1);
      for (const r of reqs) {
        expect(r.stated_on).toBe(n.importMessageDate); // stated_on = the message's own date
        expect(r.stated_on).not.toBe(n.today); // and it genuinely differs from the injected TODAY
      }
    }
  });

  // Every expected requirement is well-formed and traces to a verbatim phrase.
  // REQ-PRECISION (v0.9.2): the over-suppression guard — a real requirement sitting beside a
  // deliverable request must BOTH be captured (tightening the do-vs-find split must not blind the
  // model to the find).
  it('carries a recall-guard fixture: a requirement AND a next-step in the same note', () => {
    const guard = req.filter((n) => (n.expected.requirements ?? []).length > 0 && n.expected.next_steps.length > 0);
    expect(guard.length).toBeGreaterThanOrEqual(1);
  });

  // REQ-3P (v0.9.3): the actor-distinction fixtures — a reported third-party need is a referral
  // (next_steps), an on-behalf-of need is the client's own requirement, and both split correctly
  // in one note.
  it('carries the actor-distinction fixtures (third-party referral, on-behalf-of, actor-split)', () => {
    const ids = new Set(req.map((n) => n.id));
    expect(ids.has('req-third-party-referral')).toBe(true);
    expect(ids.has('req-on-behalf-of')).toBe(true);
    expect(ids.has('req-actor-split')).toBe(true);
  });

  it('every expected requirement is well-formed', () => {
    for (const n of req) for (const r of n.expected.requirements ?? []) {
      expect(typeof r.text).toBe('string');
      expect(r.requirement_raw.length).toBeGreaterThan(0);
      expect(r.stated_on === null || typeof r.stated_on === 'string').toBe(true);
      expect(['high', 'low']).toContain(r.confidence);
    }
  });
});
