import { describe, it, expect } from 'vitest';
import { TrainingRetentionService } from './training-retention.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryCorrectionRepository } from '../../adapters/corrections/in-memory-correction-repository.js';

const DAY = 24 * 60 * 60 * 1000;

function logRow(noteId: string) {
  return { noteId, promptVersion: 'v', model: 'stub', input: 'x', rawOutput: '{}', status: 'extracted', inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}
function corrRow(noteId: string) {
  return { noteId, entityType: 'promise', entityId: 'p', field: 'text', before: 'a', after: 'b', promptVersion: 'v' };
}

describe('[TRAINING-RETENTION] sweep', () => {
  it('is DISABLED by default (retentionDays = 0) — deletes nothing', async () => {
    const logs = new InMemoryExtractionLogRepository();
    const corrections = new InMemoryCorrectionRepository();
    await logs.log('u1', logRow('n1'));
    await corrections.record('u1', corrRow('n1'));
    const svc = new TrainingRetentionService({ extractionLog: logs, corrections, allUserIds: async () => ['u1'], retentionDays: 0 });

    const r = await svc.sweep(Date.now() + 10_000 * DAY); // even far in the future
    expect(r.enabled).toBe(false);
    expect(r.logs).toBe(0);
    expect(r.corrections).toBe(0);
    expect(await logs.listByUser('u1')).toHaveLength(1);
    expect(await corrections.listByUser('u1')).toHaveLength(1);
  });

  it('when configured, removes rows older than the window across all tenants and keeps fresh ones', async () => {
    const logs = new InMemoryExtractionLogRepository();
    const corrections = new InMemoryCorrectionRepository();
    await logs.log('u1', logRow('n1'));
    await logs.log('u2', logRow('n2'));
    await corrections.record('u1', corrRow('n1'));
    const svc = new TrainingRetentionService({
      extractionLog: logs, corrections, allUserIds: async () => ['u1', 'u2'], retentionDays: 30,
    });

    // now far enough ahead that the just-written rows are past a 30-day window → all purged.
    const future = Date.now() + 100 * DAY;
    const r = await svc.sweep(future);
    expect(r.enabled).toBe(true);
    expect(r.users).toBe(2);
    expect(r.logs).toBe(2);
    expect(r.corrections).toBe(1);
    expect(await logs.listByUser('u1')).toHaveLength(0);
    expect(await logs.listByUser('u2')).toHaveLength(0);
    expect(await corrections.listByUser('u1')).toHaveLength(0);

    // A fresh row written "now" survives a sweep run now (cutoff = now - 30d, row is newer).
    await logs.log('u1', logRow('n3'));
    const r2 = await svc.sweep(Date.now());
    expect(r2.logs).toBe(0);
    expect(await logs.listByUser('u1')).toHaveLength(1);
  });
});

describe('[TRAINING-RETENTION] purgeOlderThan is by age only and tenant-scoped', () => {
  it('extraction-log purge removes only the acting tenant\'s old rows', async () => {
    const logs = new InMemoryExtractionLogRepository();
    await logs.log('a', logRow('na'));
    await logs.log('b', logRow('nb'));
    const removed = await logs.purgeOlderThan('a', Date.now() + DAY); // cutoff in the future → a's row is old
    expect(removed).toBe(1);
    expect(await logs.listByUser('a')).toHaveLength(0);
    expect(await logs.listByUser('b')).toHaveLength(1); // b untouched
  });

  it('correction purge removes only the acting tenant\'s old rows', async () => {
    const corrections = new InMemoryCorrectionRepository();
    await corrections.record('a', corrRow('na'));
    await corrections.record('b', corrRow('nb'));
    const removed = await corrections.purgeOlderThan('a', Date.now() + DAY);
    expect(removed).toBe(1);
    expect(await corrections.listByUser('a')).toHaveLength(0);
    expect(await corrections.listByUser('b')).toHaveLength(1);
  });
});
