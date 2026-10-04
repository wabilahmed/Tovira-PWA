import { describe, it, expect, vi } from 'vitest';
import { BulkExtractionOrchestrator, bulkConcurrency, chatStateFor, type ChatJob } from './bulk-extraction.js';
import type { ExtractOutcome } from '../extraction/extraction-service.js';

const tick = async (n = 4): Promise<void> => { for (let i = 0; i < n; i += 1) await Promise.resolve(); };
type Item = { key: string };
const items = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ key: `k${i}` }));
const ok = (key: string): { noteId: string; outcome: ExtractOutcome } => ({ noteId: `note-${key}`, outcome: { status: 'extracted' } });

function orch(over: {
  items?: Item[];
  start?: (i: Item) => Promise<{ noteId: string; outcome: ExtractOutcome }>;
  isExhausted?: () => Promise<boolean>;
  isPaused?: () => Promise<boolean>;
  concurrency?: number;
  onProgress?: (j: ChatJob[]) => void;
} = {}) {
  const start = over.start ?? vi.fn(async (i: Item) => ok(i.key));
  const o = new BulkExtractionOrchestrator<Item>({
    items: over.items ?? items(3),
    keyOf: (i) => i.key,
    start,
    isExhausted: over.isExhausted ?? (async () => false),
    isPaused: over.isPaused,
    concurrency: over.concurrency ?? 4,
    onProgress: over.onProgress,
  });
  return { o, start };
}

describe('[BULK-IMPORT] per-chat extraction orchestrator (RULING 2)', () => {
  it('derives a batch concurrency below the sweep ceiling, never zero', () => {
    expect(bulkConcurrency(5)).toBe(4);
    expect(bulkConcurrency(1)).toBe(1);
  });

  it('maps a started chat outcome to a per-chat state', () => {
    expect(chatStateFor('extracted')).toBe('done');
    expect(chatStateFor('pending_confirmation')).toBe('done');
    expect(chatStateFor('spend_capped')).toBe('failed_usage_limit');
    expect(chatStateFor('trial_limit')).toBe('failed_usage_limit');
    expect(chatStateFor('needs_review')).toBe('failed');
    expect(chatStateFor('not_found')).toBe('failed');
  });

  it('warms the cache with ONE chat, awaits it, THEN fans out the rest', async () => {
    const entered: string[] = [];
    let releaseFirst = (): void => {};
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });
    const start = vi.fn(async (i: Item) => { entered.push(i.key); if (i.key === 'k0') await firstGate; return ok(i.key); });
    const { o } = orch({ start, concurrency: 4 });
    const p = o.run();
    await tick();
    expect(entered).toEqual(['k0']);
    releaseFirst();
    const jobs = await p;
    expect(entered.slice(1).sort()).toEqual(['k1', 'k2']);
    expect(jobs.every((j) => j.state === 'done')).toBe(true);
    expect(jobs.every((j) => j.noteId)).toBe(true);
  });

  it('bounds concurrency of the fan-out', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const start = vi.fn(async (i: Item) => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await tick(2); inFlight -= 1; return ok(i.key); });
    const { o } = orch({ start, items: items(9), concurrency: 2 });
    await o.run();
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('one chat failing never fails the batch', async () => {
    const start = vi.fn(async (i: Item) => { if (i.key === 'k1') throw new Error('boom'); return ok(i.key); });
    const { o } = orch({ start });
    const jobs = await o.run();
    expect(Object.fromEntries(jobs.map((j) => [j.key, j.state]))).toEqual({ k0: 'done', k1: 'failed', k2: 'done' });
  });

  it('UNSTARTED chats fail with the usage limit and are NEVER started (content discarded)', async () => {
    const start = vi.fn(async (i: Item) => ok(i.key));
    const { o } = orch({ start, isExhausted: async () => true, items: items(3) });
    const jobs = await o.run();
    expect(jobs.every((j) => j.state === 'failed_usage_limit')).toBe(true);
    expect(jobs.every((j) => j.noteId === undefined)).toBe(true); // no note created
    expect(start).not.toHaveBeenCalled(); // never persisted / extracted
  });

  it('IN-FLIGHT chats always finish; only not-yet-started chats fail at the limit', async () => {
    let startedCount = 0;
    let release = (): void => {};
    const gate = new Promise<void>((r) => { release = r; });
    const started: string[] = [];
    const start = vi.fn(async (i: Item) => {
      startedCount += 1;
      started.push(i.key);
      const n = startedCount;
      if (n >= 2 && n <= 4) await gate; // hold the 3 fan-out chats open together, in flight
      return ok(i.key);
    });
    // Exhausted once the warm-up chat + 3 fan-out chats have started.
    const { o } = orch({ start, isExhausted: async () => startedCount >= 4, items: items(6), concurrency: 3 });
    const p = o.run();
    await tick(6); // let warm-up finish and the 3 fan-out chats enter and block
    release();
    const jobs = await p;
    const by = Object.fromEntries(jobs.map((j) => [j.key, j.state]));
    // k0 (warm-up) + k1,k2,k3 (in flight) all complete; k4,k5 never started → usage-limit terminal.
    expect(by).toEqual({ k0: 'done', k1: 'done', k2: 'done', k3: 'done', k4: 'failed_usage_limit', k5: 'failed_usage_limit' });
    expect(started.sort()).toEqual(['k0', 'k1', 'k2', 'k3']); // k4/k5 were never started (discarded)
  });

  it('the kill switch stops new chats from starting', async () => {
    const start = vi.fn(async (i: Item) => ok(i.key));
    const { o } = orch({ start, isPaused: async () => true, items: items(2) });
    const jobs = await o.run();
    expect(jobs.every((j) => j.state === 'failed')).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it('reports progress as states advance', async () => {
    const seen: ChatJob[][] = [];
    const { o } = orch({ onProgress: (j) => seen.push(j.map((x) => ({ ...x }))) });
    await o.run();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)!.every((j) => j.state === 'done')).toBe(true);
  });
});
