import { describe, it, expect, vi } from 'vitest';
import { NoteSweepService, type NoteSweepDeps, type SweepableNote } from './note-sweep-service.js';

function make(pending: Record<string, SweepableNote[]>, over: Partial<NoteSweepDeps> = {}, max = 3) {
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
  return { svc: new NoteSweepService(deps, max), calls };
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
});
