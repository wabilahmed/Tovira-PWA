import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadConfig } from '../../config.js';
import { createExtractionModelRouter } from '../../container.js';
import { GatedModelClient } from '../../adapters/spend/gated-ai-clients.js';
import { MeteredModelClient } from '../../adapters/model/metered.js';
import { AnthropicBatchClient, AnthropicModelClient } from '../../adapters/model/anthropic.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { BulkExtractionOrchestrator } from './bulk-extraction.js';
import { withClaimHeartbeat } from './claim-heartbeat.js';

/**
 * [P81-2 · owner, 21 Nov] Bulk and multi-file imports go through the Message Batches API; a single live import
 * stays live. The batched route is still gated and metered (the same wrappers as live). In batch mode there is no
 * one-chat warm-up (it would cost a whole batch round), and a chat waiting on a batch keeps its claim fresh, so the
 * sweep never reads it a second time.
 */
const base = { DATABASE_URL: 'postgres://t:t@localhost:5432/t', MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' };

describe('[P81-2] config', () => {
  it('batch for bulk imports is on by default; BULK_IMPORT_BATCH=0 turns it off', () => {
    expect(loadConfig(base).bulkImportBatch).toBe(true);
    expect(loadConfig({ ...base, BULK_IMPORT_BATCH: '0' }).bulkImportBatch).toBe(false);
    expect(() => loadConfig({ ...base, BULK_IMPORT_BATCH: 'maybe' })).toThrow(/BULK_IMPORT_BATCH/);
  });
});

describe('[P81-2] the batched route is gated and metered like live', () => {
  it('batch: gate → meter → batch client → live client (for the fallback)', async () => {
    const r = createExtractionModelRouter(loadConfig(base), async () => 'active', { batch: true })!;
    const m = (await r.resolve('u')).model;
    expect(m).toBeInstanceOf(GatedModelClient);
    const metered = (m as GatedModelClient).inner;
    expect(metered).toBeInstanceOf(MeteredModelClient);
    expect((metered as MeteredModelClient).inner).toBeInstanceOf(AnthropicBatchClient);
  });
  it('NEGATIVE: without the option (every live path) the router is exactly as before: no batch client', async () => {
    const m = (await createExtractionModelRouter(loadConfig(base), async () => 'active')!.resolve('u')).model as GatedModelClient;
    expect((m.inner as MeteredModelClient).inner).toBeInstanceOf(AnthropicModelClient);
  });
});

describe('[P81-2] batch mode in the bulk runner', () => {
  const run = async (warmUp: boolean | undefined) => {
    const order: string[] = [];
    let live = 0, max = 0;
    await new BulkExtractionOrchestrator<string>({
      items: ['a', 'b', 'c', 'd'], keyOf: (x) => x, concurrency: 4, isExhausted: async () => false, ...(warmUp === undefined ? {} : { warmUp }),
      start: async (x) => { live++; max = Math.max(max, live); order.push(x); await new Promise((r) => setTimeout(r, 5)); live--; return { noteId: x, outcome: { status: 'extracted' } as never }; },
    }).run();
    return { max };
  };
  it('with warmUp false, every chat starts together (one batch round, not two)', async () => {
    expect((await run(false)).max).toBe(4);
  });
  it('NEGATIVE: by default the first chat still runs alone first (live warm-up unchanged)', async () => {
    expect((await run(undefined)).max).toBe(3);
  });
});

describe('[P81-2] a chat waiting on a batch keeps its claim fresh', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('the claim is touched on an interval while the work runs, and not after', async () => {
    vi.useFakeTimers();
    const touched: number[] = [];
    let finish!: () => void;
    const p = withClaimHeartbeat(async () => { touched.push(Date.now()); }, 60_000, () => new Promise<string>((r) => { finish = () => r('done'); }));
    await vi.advanceTimersByTimeAsync(185_000);
    expect(touched).toHaveLength(3);
    finish();
    await expect(p).resolves.toBe('done');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(touched).toHaveLength(3);
  });
  it('NEGATIVE: a failing touch never fails the extraction', async () => {
    await expect(withClaimHeartbeat(async () => { throw new Error('db'); }, 1, async () => { await new Promise((r) => setTimeout(r, 10)); return 'ok'; })).resolves.toBe('ok');
  });
  it('touching keeps an extracting note out of the sweep reclaim; only an extracting note is touched', async () => {
    const notes = new InMemoryNoteRepository();
    const n = await notes.create('u', { clientId: 'c', source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'pending_extraction', messages: [] });
    await notes.claimForExtraction('u', n.id, 0);
    await notes.touchExtractionClaim('u', n.id, 9 * 60_000);
    expect(await notes.reclaimStaleExtracting('u', 15 * 60_000, 10 * 60_000)).toBe(0); // touched at 9 min: not stale at 15
    expect(await notes.reclaimStaleExtracting('u', 20 * 60_000, 10 * 60_000)).toBe(1);
    await notes.touchExtractionClaim('u', n.id, 21 * 60_000); // now pending again: a touch must not claim it
    expect((await notes.findByIdForUser('u', n.id))!.status).toBe('pending_extraction');
  });
});
