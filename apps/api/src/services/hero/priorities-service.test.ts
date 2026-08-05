import { describe, it, expect } from 'vitest';
import { PrioritiesService, RefreshLimitError } from './priorities-service.js';
import { InMemoryPrioritiesRepository } from '../../adapters/priorities/in-memory-priorities-repository.js';
import { LocalScheduler } from '../../adapters/scheduler/local.js';
import type { TodayAction } from './hero-service.js';
import type { ModelClient } from '../../ports/model.js';

const NOW = Date.parse('2026-08-05T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const action = (i: number): TodayAction => ({ kind: 'promise', priority: i, text: `action ${i}`, clientId: `c${i}` });

/** A model that counts calls; returns a (valid) reordering by default. */
function countingModel(text = '[1,0]'): { model: ModelClient; calls: () => number } {
  let calls = 0;
  return { model: { complete: async () => { calls += 1; return { text }; } }, calls: () => calls };
}

function heroWith(actionsByUser: Record<string, TodayAction[]>): { today(userId: string, nowMs: number): Promise<TodayAction[]> } {
  return { today: async (userId) => actionsByUser[userId] ?? [] };
}

describe('PrioritiesService (P4b-3, cost-guard #3)', () => {
  // CALL-COUNT: opening /today 10 times in a day = exactly ONE computation.
  it('serves the cache on reads — 10 opens after a precompute = ZERO extra model calls', async () => {
    const { model, calls } = countingModel();
    const repo = new InMemoryPrioritiesRepository();
    const svc = new PrioritiesService(heroWith({ u: [action(0), action(1)] }), model, repo);

    await svc.precompute('u', NOW);        // the nightly job
    expect(calls()).toBe(1);
    for (let i = 0; i < 10; i++) await svc.getForToday('u', NOW);
    expect(calls()).toBe(1);               // reads never recompute → still 1
  });

  // COMPUTE-ONCE on first open (new signup mid-day, no precomputed row).
  it('computes once on first open, then serves the stored copy', async () => {
    const { model, calls } = countingModel();
    const svc = new PrioritiesService(heroWith({ u: [action(0)] }), model, new InMemoryPrioritiesRepository());
    for (let i = 0; i < 10; i++) await svc.getForToday('u', NOW);
    expect(calls()).toBe(1); // exactly ONE computation for the day
  });

  // IDEMPOTENT: re-running the nightly job the same night does not recompute.
  it('precompute is idempotent for the same day', async () => {
    const { model, calls } = countingModel();
    const repo = new InMemoryPrioritiesRepository();
    const svc = new PrioritiesService(heroWith({ u: [action(0)] }), model, repo);
    expect(await svc.precompute('u', NOW)).toBe(true);
    expect(await svc.precompute('u', NOW)).toBe(false); // already done tonight
    expect(calls()).toBe(1);
  });

  it('recomputes for a new day', async () => {
    const { model, calls } = countingModel();
    const svc = new PrioritiesService(heroWith({ u: [action(0)] }), model, new InMemoryPrioritiesRepository());
    await svc.getForToday('u', NOW);
    await svc.getForToday('u', NOW + DAY); // next day → fresh compute
    expect(calls()).toBe(2);
  });

  // RATE LIMIT: manual refresh capped server-side (default 2/day).
  it('rate-limits manual refresh to 2 per rep per day', async () => {
    const { model, calls } = countingModel();
    const svc = new PrioritiesService(heroWith({ u: [action(0)] }), model, new InMemoryPrioritiesRepository(), { modelId: 'stub', refreshLimit: 2 });
    await svc.precompute('u', NOW);
    await svc.refresh('u', NOW);
    await svc.refresh('u', NOW);
    await expect(svc.refresh('u', NOW)).rejects.toBeInstanceOf(RefreshLimitError);
    expect(calls()).toBe(3); // precompute + 2 refreshes; the blocked 3rd never computed
  });

  it('refresh limit resets on a new day', async () => {
    const { model } = countingModel();
    const svc = new PrioritiesService(heroWith({ u: [action(0)] }), model, new InMemoryPrioritiesRepository(), { modelId: 'stub', refreshLimit: 2 });
    await svc.refresh('u', NOW);
    await svc.refresh('u', NOW);
    await expect(svc.refresh('u', NOW + DAY)).resolves.toBeDefined(); // new day → allowed
  });

  // EMPTY DATA: honest empty state, and NO model call to rank nothing.
  it('returns an empty list with no model call when there is no data', async () => {
    const { model, calls } = countingModel();
    const svc = new PrioritiesService(heroWith({ u: [] }), model, new InMemoryPrioritiesRepository());
    expect(await svc.getForToday('u', NOW)).toEqual([]);
    expect(calls()).toBe(0);
  });

  // GROUNDING: the model may only reorder — a hallucinated/garbage response never
  // fabricates or drops actions.
  it('never fabricates or drops actions if the model returns garbage', async () => {
    const { model } = countingModel('not json at all');
    const svc = new PrioritiesService(heroWith({ u: [action(0), action(1)] }), model, new InMemoryPrioritiesRepository());
    const out = await svc.getForToday('u', NOW);
    expect(out.map((a) => a.text).sort()).toEqual(['action 0', 'action 1']); // both real actions kept
  });

  it('ignores invalid indices and preserves every real action', async () => {
    const { model } = countingModel('[1, 99, 0]'); // 99 is out of range
    const svc = new PrioritiesService(heroWith({ u: [action(0), action(1)] }), model, new InMemoryPrioritiesRepository());
    const out = await svc.getForToday('u', NOW);
    expect(out.map((a) => a.text)).toEqual(['action 1', 'action 0']); // reordered, none invented/lost
  });

  // ISOLATION: never another rep's actions.
  it('is tenant-scoped', async () => {
    const { model } = countingModel();
    const svc = new PrioritiesService(heroWith({ a: [action(0)] }), model, new InMemoryPrioritiesRepository());
    await svc.getForToday('a', NOW);
    expect(await svc.getForToday('b', NOW)).toEqual([]);
  });

  // Nightly precompute over many users.
  it('precomputeAll computes each listed user once', async () => {
    const { model, calls } = countingModel();
    const svc = new PrioritiesService(heroWith({ u1: [action(0)], u2: [action(1)] }), model, new InMemoryPrioritiesRepository());
    await svc.precomputeAll(['u1', 'u2'], NOW);
    expect(calls()).toBe(2);
  });

  // Reuses the existing scheduler seam (same port as the cold scan / Monday job).
  it('runs as a registered scheduled job that precomputes all reps', async () => {
    const { model, calls } = countingModel();
    const repo = new InMemoryPrioritiesRepository();
    const svc = new PrioritiesService(heroWith({ u1: [action(0)], u2: [action(1)] }), model, repo);
    const scheduler = new LocalScheduler();
    scheduler.register({ name: 'priorities-nightly', run: async () => { await svc.precomputeAll(['u1', 'u2'], NOW); } });
    expect(scheduler.list()).toContain('priorities-nightly');
    await scheduler.trigger('priorities-nightly');
    expect(calls()).toBe(2);
    // After the nightly run, opens serve the cache — no further computes.
    await svc.getForToday('u1', NOW);
    await svc.getForToday('u2', NOW);
    expect(calls()).toBe(2);
  });
});
