import { describe, it, expect } from 'vitest';
import { InMemoryStorage } from '../../adapters/storage/in-memory.js';
import { putBatchFile, listBatchFiles, purgeUserBatches, listBatches, clearBatch } from './bulk-batch-store.js';
import { BulkBatchRetentionService, BULK_BATCH_TTL_MS } from './bulk-batch-retention.js';

describe('[BULK-IMPORT · FIX 2] staged-upload retention + purge', () => {
  it('putBatchFile stores the file + a creation marker that listBatches reports', async () => {
    const s = new InMemoryStorage();
    await putBatchFile(s, 'u1', 'b1', 0, { name: 'a.txt', content: 'chat' }, 5_000);
    const batches = await listBatches(s);
    expect(batches).toEqual([{ userId: 'u1', batchId: 'b1', createdAt: 5_000 }]);
    expect(await listBatchFiles(s, 'u1', 'b1')).toEqual([{ name: 'a.txt', content: 'chat' }]);
  });

  it('(c) sweeps a batch older than the TTL and keeps a fresh one', async () => {
    const s = new InMemoryStorage();
    await putBatchFile(s, 'u1', 'old', 0, { name: 'a.txt', content: 'secret chat' }, 1_000);
    await putBatchFile(s, 'u2', 'fresh', 0, { name: 'b.txt', content: 'y' }, 1_000 + BULK_BATCH_TTL_MS);
    const now = 1_000 + BULK_BATCH_TTL_MS + 1;
    expect(await new BulkBatchRetentionService(s).sweep(now)).toBe(1);
    expect(await listBatchFiles(s, 'u1', 'old')).toEqual([]); // content deleted
    expect(await listBatchFiles(s, 'u2', 'fresh')).toHaveLength(1); // still within the TTL
  });

  it('(account deletion / erasure) purgeUserBatches wipes ALL of one rep\'s staged batches, not another\'s', async () => {
    const s = new InMemoryStorage();
    await putBatchFile(s, 'victim', 'b1', 0, { name: 'a.txt', content: 'x' }, 1);
    await putBatchFile(s, 'victim', 'b2', 0, { name: 'b.txt', content: 'y' }, 1);
    await putBatchFile(s, 'other', 'b3', 0, { name: 'c.txt', content: 'z' }, 1);
    await purgeUserBatches(s, 'victim');
    expect(await listBatchFiles(s, 'victim', 'b1')).toEqual([]);
    expect(await listBatchFiles(s, 'victim', 'b2')).toEqual([]);
    expect(await listBatchFiles(s, 'other', 'b3')).toHaveLength(1); // another rep untouched
  });

  it('(b) clearBatch removes a single abandoned batch', async () => {
    const s = new InMemoryStorage();
    await putBatchFile(s, 'u1', 'b1', 0, { name: 'a.txt', content: 'x' }, 1);
    await clearBatch(s, 'u1', 'b1');
    expect(await listBatchFiles(s, 'u1', 'b1')).toEqual([]);
  });
});
