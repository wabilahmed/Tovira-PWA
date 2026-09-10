import { describe, it, expect } from 'vitest';
import { TrainingLogStatsService } from './training-log-stats.js';
import type { TrainingLogStats, TrainingLogStatsRepository } from '../../ports/training-log-stats-repository.js';

function repo(stats: TrainingLogStats, onCall: () => void): TrainingLogStatsRepository {
  return { aggregate: async () => { onCall(); return stats; } };
}
const STATS: TrainingLogStats = { total: 10, last24h: 3, emptyOutput: 1, corrections: 4, archived: 7, byPromptVersion: { 'v0.9.4': 10 } };

describe('[TRAINING-METRICS] cached stats service', () => {
  it('snapshot() is instant and does not scan per call — the aggregate runs at most once per TTL', async () => {
    let calls = 0;
    let clock = 1_000_000;
    const svc = new TrainingLogStatsService(repo(STATS, () => { calls += 1; }), 60_000, () => clock);

    // Warm the cache once (awaitable for determinism).
    await svc.refresh();
    expect(calls).toBe(1);
    expect(svc.snapshot().total).toBe(10);
    expect(svc.snapshot().corrections).toBe(4);

    // Within the TTL, repeated snapshots return the cached value WITHOUT another aggregate call.
    for (let i = 0; i < 20; i++) svc.snapshot();
    expect(calls).toBe(1);

    // Past the TTL, the next snapshot triggers exactly one more refresh (aggregate runs synchronously
    // at the start of the fire-and-forget refresh, so the count is observable immediately).
    clock += 61_000;
    svc.snapshot();
    expect(calls).toBe(2);
    // And it stays throttled: further snapshots in the same window don't scan again.
    svc.snapshot();
    expect(calls).toBe(2);
  });

  it('a failing aggregate never throws and leaves the last good cache intact', async () => {
    const clock = 0;
    const failing: TrainingLogStatsRepository = { aggregate: async () => { throw new Error('db down'); } };
    const svc = new TrainingLogStatsService(failing, 60_000, () => clock);
    await expect(svc.refresh()).resolves.toBeDefined();
    expect(svc.snapshot().total).toBe(0); // still the empty default, no crash
  });
});
