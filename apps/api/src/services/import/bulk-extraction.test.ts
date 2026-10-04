import { describe, it, expect, vi } from 'vitest';
import { BulkExtractionOrchestrator, bulkConcurrency, chatStateFor, type ChatJob } from './bulk-extraction.js';
import type { ExtractOutcome } from '../extraction/extraction-service.js';

const tick = async (n = 3): Promise<void> => { for (let i = 0; i < n; i += 1) await Promise.resolve(); };
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `n${i}`);

describe('[BULK-IMPORT] per-chat extraction orchestrator', () => {
  it('derives a batch concurrency BELOW the sweep ceiling (headroom), never zero', () => {
    expect(bulkConcurrency(5)).toBe(4); // sweepConcurrency=5 → leave one lane for the live capture path
    expect(bulkConcurrency(1)).toBe(1); // never zero
  });

  it('maps an extraction outcome to a per-chat state', () => {
    expect(chatStateFor('extracted')).toBe('done');
    expect(chatStateFor('pending_confirmation')).toBe('done');
    expect(chatStateFor('spend_capped')).toBe('paused_usage_limit');
    expect(chatStateFor('trial_limit')).toBe('paused_usage_limit');
    expect(chatStateFor('needs_review')).toBe('failed');
    expect(chatStateFor('not_found')).toBe('failed');
  });

  it('warms the cache with ONE call, awaits it, THEN fans out the rest', async () => {
    const entered: string[] = [];
    let releaseFirst = (): void => {};
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });
    const extract = vi.fn(async (_u: string, id: string): Promise<ExtractOutcome> => {
      entered.push(id);
      if (id === 'n0') await firstGate; // hold the warm-up call open
      return { status: 'extracted' };
    });
    const orch = new BulkExtractionOrchestrator({ extract, isExhausted: async () => false, concurrency: 4 });
    const p = orch.run('u', ids(3), '2026-10-04');
    await tick();
    expect(entered).toEqual(['n0']); // ONLY the warm-up is in flight — nothing fanned out yet
    releaseFirst();
    const jobs = await p;
    expect(entered.slice(1).sort()).toEqual(['n1', 'n2']); // the rest ran after the warm-up resolved
    expect(jobs.every((j) => j.state === 'done')).toBe(true);
  });

  it('bounds concurrency of the fan-out', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const extract = vi.fn(async (): Promise<ExtractOutcome> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick(2);
      inFlight -= 1;
      return { status: 'extracted' };
    });
    const orch = new BulkExtractionOrchestrator({ extract, isExhausted: async () => false, concurrency: 2 });
    await orch.run('u', ids(8), '2026-10-04');
    expect(maxInFlight).toBeLessThanOrEqual(2); // never more than the derived lane count
  });

  it('one chat failing never fails the batch — the others still extract', async () => {
    const extract = vi.fn(async (_u: string, id: string): Promise<ExtractOutcome> => {
      if (id === 'n1') throw new Error('model exploded on this chat');
      return { status: 'extracted' };
    });
    const orch = new BulkExtractionOrchestrator({ extract, isExhausted: async () => false, concurrency: 4 });
    const jobs = await orch.run('u', ids(3), '2026-10-04');
    const by = Object.fromEntries(jobs.map((j) => [j.noteId, j.state]));
    expect(by).toEqual({ n0: 'done', n1: 'failed', n2: 'done' });
  });

  it('stops at the allowance limit: over-limit chats are paused, never errored, and never call the model', async () => {
    let done = 0;
    const extract = vi.fn(async (): Promise<ExtractOutcome> => { done += 1; return { status: 'extracted' }; });
    // Exhausted once two chats have been extracted this run.
    const orch = new BulkExtractionOrchestrator({ extract, isExhausted: async () => done >= 2, concurrency: 1 });
    const jobs = await orch.run('u', ids(4), '2026-10-04');
    const states = jobs.map((j) => j.state);
    expect(states.filter((s) => s === 'done')).toHaveLength(2);
    expect(states.filter((s) => s === 'paused_usage_limit')).toHaveLength(2);
    expect(states).not.toContain('failed');
    expect(extract).toHaveBeenCalledTimes(2); // the paused chats never reached the model
  });

  it('reports progress as states advance', async () => {
    const seen: ChatJob[][] = [];
    const extract = vi.fn(async (): Promise<ExtractOutcome> => ({ status: 'extracted' }));
    const orch = new BulkExtractionOrchestrator({
      extract,
      isExhausted: async () => false,
      concurrency: 2,
      onProgress: (jobs) => seen.push(jobs.map((j) => ({ ...j }))),
    });
    await orch.run('u', ids(3), '2026-10-04');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)!.every((j) => j.state === 'done')).toBe(true);
  });
});
