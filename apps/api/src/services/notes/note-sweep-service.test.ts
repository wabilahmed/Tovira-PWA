import { describe, it, expect, vi } from 'vitest';
import { NoteSweepService, type NoteSweepDeps, type SweepableNote } from './note-sweep-service.js';

function make(pending: Record<string, SweepableNote[]>, over: Partial<NoteSweepDeps> = {}, max = 3, concurrency = 1) {
  const calls = { transcribe: [] as string[], extract: [] as string[], review: [] as string[], attempts: [] as Array<[string, number]> };
  const deps: NoteSweepDeps = {
    allUserIds: async () => Object.keys(pending),
    listPending: async (u) => pending[u] ?? [],
    transcribe: async (_u, id) => { calls.transcribe.push(id); },
    extract: async (_u, id) => { calls.extract.push(id); },
    setAttempts: async (_u, id, n) => { calls.attempts.push([id, n]); },
    markNeedsReview: async (_u, id) => { calls.review.push(id); },
    ...over,
  };
  return { svc: new NoteSweepService(deps, max, concurrency), calls };
}
const note = (id: string, status: string, sweepAttempts = 0): SweepableNote => ({ id, status, sweepAttempts });

describe('[FLOWS-7] NoteSweepService — advance stuck notes, bounded, never lost', () => {
  it('transcribes stuck transcription notes and extracts stuck extraction notes, across all reps', async () => {
    const { svc, calls } = make({
      u1: [note('a', 'pending_transcription')],
      u2: [note('b', 'pending_extraction')],
    });
    const r = await svc.sweep('2026-08-01');
    expect(calls.transcribe).toEqual(['a']);
    expect(calls.extract).toEqual(['b']);
    expect(r.advanced).toBe(2);
    expect(calls.attempts).toEqual([['a', 1], ['b', 1]]); // each attempt counted
  });

  it('bounds retries: a note at the attempt ceiling is flagged needs_review, not retried', async () => {
    const { svc, calls } = make({ u1: [note('stuck', 'pending_transcription', 3)] }, {}, 3);
    const r = await svc.sweep('2026-08-01');
    expect(calls.review).toEqual(['stuck']); // terminal flag
    expect(calls.transcribe).toEqual([]); // not retried
    expect(r.flagged).toBe(1);
  });

  it('a step that keeps throwing converges to needs_review over sweeps (attempts still counted)', async () => {
    const pending = { u1: [note('flaky', 'pending_transcription', 0)] };
    const { svc, calls } = make(pending, { transcribe: vi.fn().mockRejectedValue(new Error('groq down')) }, 2);
    // sweep 1: attempt 0 → bump to 1, transcribe throws (stays pending)
    await svc.sweep('2026-08-01');
    expect(calls.attempts.at(-1)).toEqual(['flaky', 1]);
    expect(calls.review).toEqual([]);
    // simulate the persisted bump, then sweep again until it hits the ceiling
    pending.u1[0]!.sweepAttempts = 2; // now at max
    await svc.sweep('2026-08-01');
    expect(calls.review).toEqual(['flaky']); // flagged, never silently dropped
  });

  it('does nothing when no note is pending', async () => {
    const { svc, calls } = make({ u1: [] });
    const r = await svc.sweep('2026-08-01');
    expect(r).toEqual({ advanced: 0, flagged: 0 });
    expect(calls.transcribe).toEqual([]);
  });

  // [SPEND-CAP] A capped rep's queue waits, untouched — no attempt bump, no needs_review, not lost.
  it('leaves a capped rep\'s pending notes untouched, and drains an uncapped rep normally', async () => {
    const capped = new Set(['poor']);
    const { svc, calls } = make(
      { poor: [note('x', 'pending_extraction')], rich: [note('y', 'pending_extraction')] },
      { canSpend: async (u) => !capped.has(u) },
    );
    const r = await svc.sweep('2026-08-01');
    expect(calls.extract).toEqual(['y']); // only the uncapped rep advanced
    expect(calls.attempts).toEqual([['y', 1]]); // the capped note's retry budget is NOT spent
    expect(calls.review).toEqual([]); // never flagged
    expect(r.advanced).toBe(1);
  });

  // [TRIAL-FARM] An unverified rep's queue waits the same way — no attempt bump, no needs_review.
  it('leaves an UNVERIFIED rep\'s pending notes untouched, and drains a verified rep normally', async () => {
    const verified = new Set(['done']);
    const { svc, calls } = make(
      { unver: [note('x', 'pending_extraction')], done: [note('y', 'pending_extraction')] },
      { isVerified: async (u) => verified.has(u) },
    );
    const r = await svc.sweep('2026-08-01');
    expect(calls.extract).toEqual(['y']); // only the verified rep advanced
    expect(calls.attempts).toEqual([['y', 1]]); // the unverified note's retry budget is NOT spent
    expect(calls.review).toEqual([]); // never flagged
    expect(r.advanced).toBe(1);
  });

  it('resumes a rep once they verify (queued note extracts, retry budget intact)', async () => {
    let verified = false;
    const { svc, calls } = make(
      { rep: [note('x', 'pending_extraction')] },
      { isVerified: async () => verified },
    );
    await svc.sweep('2026-08-01');
    expect(calls.extract).toEqual([]); // deferred while unverified
    verified = true;
    await svc.sweep('2026-08-02');
    expect(calls.extract).toEqual(['x']); // released on verify, intact
  });

  it('resumes a previously-capped rep once they are under the cap again', async () => {
    let capped = true;
    const { svc, calls } = make(
      { poor: [note('x', 'pending_extraction')] },
      { canSpend: async () => !capped },
    );
    await svc.sweep('2026-08-01');
    expect(calls.extract).toEqual([]); // deferred
    capped = false;
    await svc.sweep('2026-08-02');
    expect(calls.extract).toEqual(['x']); // released, intact (attempts fresh)
  });
});

// ---- [ASYNC-EXTRACT] the sweep is the PRIMARY processor: ceiling skip, fairness, concurrency ----
describe('[ASYNC-EXTRACT] NoteSweepService — ceiling skip + fairness + bounded concurrency', () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // The ceiling→needs_review bug fix: a rep at their extraction ceiling is SKIPPED like a capped or
  // unverified rep — queue untouched, no attempt bump, never needs_review.
  it('leaves a rep AT THE CEILING untouched (no attempt bump, no needs_review), drains an allowed rep', async () => {
    const capped = new Set(['ceiling']);
    const { svc, calls } = make(
      { ceiling: [note('x', 'pending_extraction')], ok: [note('y', 'pending_extraction')] },
      { allow: async (u) => !capped.has(u) },
    );
    const r = await svc.sweep('2026-08-01');
    expect(calls.extract).toEqual(['y']); // only the allowed rep advanced
    expect(calls.attempts).toEqual([['y', 1]]); // the ceilinged note's retry budget is NOT spent
    expect(calls.review).toEqual([]); // never flagged needs_review
    expect(r.advanced).toBe(1);
  });

  it('resumes a rep once the ceiling lifts (subscribe / next period)', async () => {
    let capped = true;
    const { svc, calls } = make({ rep: [note('x', 'pending_extraction')] }, { allow: async () => !capped });
    await svc.sweep('2026-08-01');
    expect(calls.extract).toEqual([]); // deferred at the ceiling
    capped = false;
    await svc.sweep('2026-08-02');
    expect(calls.extract).toEqual(['x']); // released, intact
  });

  // FAIRNESS: round-robin interleave means a rep's single note is not stuck behind another rep's book.
  it('round-robins so a big book does not starve a single note (small note processed in column 0)', async () => {
    const { svc, calls } = make({
      big: [note('a0', 'pending_extraction'), note('a1', 'pending_extraction'), note('a2', 'pending_extraction')],
      small: [note('b0', 'pending_extraction')],
    }, {}, 5, 1); // concurrency 1 → deterministic order
    await svc.sweep('2026-08-01');
    // Column 0 = [a0, b0]; the single note b0 is processed 2nd, NOT after the whole big book.
    expect(calls.extract).toEqual(['a0', 'b0', 'a1', 'a2']);
  });

  // BOUNDED CONCURRENCY: up to K notes in flight at once (throughput), never more.
  it('processes up to `concurrency` notes at once, and no more', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const notes = ['n0', 'n1', 'n2', 'n3', 'n4'].map((id) => note(id, 'pending_extraction'));
    const { svc } = make({ u: notes }, {
      extract: async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await delay(15); inFlight -= 1; },
    }, 10, 3);
    await svc.sweep('2026-08-01');
    expect(maxInFlight).toBe(3); // exactly the bound — concurrent, not serial (1), not unbounded (5)
  });

  it('two accounts queueing simultaneously both make progress in one pass', async () => {
    const { svc, calls } = make({ A: [note('a', 'pending_extraction')], B: [note('b', 'pending_extraction')] }, {}, 5, 2);
    await svc.sweep('2026-08-01');
    expect(calls.extract.sort()).toEqual(['a', 'b']); // both advanced
  });

  // IDEMPOTENT within a pass: the shared cursor hands each note to exactly one worker.
  it('extracts each note exactly once per pass, even under concurrency', async () => {
    const counts: Record<string, number> = {};
    const notes = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'].map((id) => note(id, 'pending_extraction'));
    const { svc } = make({ u: notes }, {
      extract: async (_u, id) => { counts[id] = (counts[id] ?? 0) + 1; await delay(5); },
    }, 10, 4);
    await svc.sweep('2026-08-01');
    expect(Object.values(counts)).toEqual([1, 1, 1, 1, 1, 1]); // each once, none twice
  });
});
