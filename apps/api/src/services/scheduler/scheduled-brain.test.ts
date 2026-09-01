import { describe, it, expect } from 'vitest';
import { ScheduledBrain, type BrainJob } from './scheduled-brain.js';
import { InMemoryAdvisoryLock, InMemoryJobRunStore } from '../../adapters/scheduler/in-memory-scheduled-jobs.js';
import type { AdvisoryLock } from '../../ports/scheduled-jobs.js';

function job(over: Partial<BrainJob> & Pick<BrainJob, 'name' | 'run'>): BrainJob {
  return { lockKey: 1, intervalMs: 1000, ...over };
}

describe('[SWEEP-NEVER-RUNS] ScheduledBrain', () => {
  it('runs a due job and records a successful run', async () => {
    const store = new InMemoryJobRunStore();
    let ran = 0;
    const brain = new ScheduledBrain({
      jobs: [job({ name: 'sweep', run: async () => { ran += 1; } })],
      lock: new InMemoryAdvisoryLock(),
      store,
      now: () => 10_000,
    });
    await brain.runDue();
    expect(ran).toBe(1);
    const [rec] = await store.list();
    expect(rec).toMatchObject({ name: 'sweep', lastRunAt: 10_000, ok: true, error: null });
  });

  it('does not run a job again within its interval (gated by the last-run store)', async () => {
    const store = new InMemoryJobRunStore();
    let ran = 0;
    let t = 10_000;
    const brain = new ScheduledBrain({
      jobs: [job({ name: 'sweep', intervalMs: 1000, run: async () => { ran += 1; } })],
      lock: new InMemoryAdvisoryLock(),
      store,
      now: () => t,
    });
    await brain.runDue(); // runs (never run before)
    t = 10_500; // only 500ms later — still inside the 1000ms interval
    await brain.runDue(); // must NOT run
    expect(ran).toBe(1);
    t = 11_000; // 1000ms after the first run — due again
    await brain.runDue();
    expect(ran).toBe(2);
  });

  it('records a failed run (ok:false + message) and never throws out of the tick', async () => {
    const store = new InMemoryJobRunStore();
    const brain = new ScheduledBrain({
      jobs: [job({ name: 'sweep', run: async () => { throw new Error('bedrock down'); } })],
      lock: new InMemoryAdvisoryLock(),
      store,
      now: () => 5_000,
      log: () => {},
    });
    await expect(brain.runDue()).resolves.toBeUndefined();
    const [rec] = await store.list();
    expect(rec).toMatchObject({ name: 'sweep', ok: false });
    expect(rec!.error).toContain('bedrock down');
  });

  it('a failing job does not prevent the other jobs in the same tick', async () => {
    const store = new InMemoryJobRunStore();
    let bRan = 0;
    const brain = new ScheduledBrain({
      jobs: [
        job({ name: 'a', lockKey: 1, run: async () => { throw new Error('boom'); } }),
        job({ name: 'b', lockKey: 2, run: async () => { bRan += 1; } }),
      ],
      lock: new InMemoryAdvisoryLock(),
      store,
      now: () => 5_000,
      log: () => {},
    });
    await brain.runDue();
    expect(bRan).toBe(1);
    expect((await store.list()).map((r) => `${r.name}:${r.ok}`)).toEqual(['a:false', 'b:true']);
  });

  it('skips the job (does not run it) when another task holds the lock', async () => {
    const store = new InMemoryJobRunStore();
    // A lock that is always "held elsewhere" — withLock returns false, fn never runs.
    const heldLock: AdvisoryLock = { withLock: async () => false };
    let ran = 0;
    const brain = new ScheduledBrain({
      jobs: [job({ name: 'sweep', run: async () => { ran += 1; } })],
      lock: heldLock,
      store,
      now: () => 5_000,
    });
    await brain.runDue();
    expect(ran).toBe(0);
    expect(await store.list()).toEqual([]); // nothing recorded — we didn't run it
  });

  it('two tasks sharing a store+lock run a due job exactly once (no double-run)', async () => {
    const store = new InMemoryJobRunStore();
    const lock = new InMemoryAdvisoryLock(); // shared → simulates two tasks, one DB
    let ran = 0;
    const mk = () =>
      new ScheduledBrain({
        jobs: [job({ name: 'sweep', intervalMs: 1000, run: async () => { ran += 1; } })],
        lock,
        store,
        now: () => 10_000,
      });
    const a = mk();
    const b = mk();
    await a.runDue();
    await b.runDue(); // sees the fresh last-run (10_000, within interval) → skips
    expect(ran).toBe(1);
  });
});
