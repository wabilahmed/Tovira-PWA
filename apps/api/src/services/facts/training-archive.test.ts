import { describe, it, expect } from 'vitest';
import { TrainingArchiveService, type ArchivableRecord, type ArchivableCollection } from './training-archive.js';
import { InMemoryStorage } from '../../adapters/storage/in-memory.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryArchiveIndexRepository } from '../../adapters/logs/in-memory-archive-index-repository.js';

const DAY = 24 * 60 * 60 * 1000;
const DEST = 'training-archive';
const dec = new TextDecoder();

function logRow(noteId: string) {
  return { noteId, promptVersion: 'tovira-extract-v0.9.4', model: 'stub', input: 'raw note text', rawOutput: '{}', status: 'extracted', inputTokens: 1, outputTokens: 1, latencyMs: 1 };
}

function logCollection(logs: InMemoryExtractionLogRepository): ArchivableCollection<ArchivableRecord> {
  return {
    name: 'extraction_logs',
    listOlderThan: (u, c) => logs.listOlderThan(u, c) as unknown as Promise<ArchivableRecord[]>,
    deleteByIds: (u, ids) => logs.deleteByIds(u, ids),
  };
}

function build(overrides: Partial<{ ageDays: number; destination: string }> = {}) {
  const storage = new InMemoryStorage();
  const logs = new InMemoryExtractionLogRepository();
  const index = new InMemoryArchiveIndexRepository();
  const svc = new TrainingArchiveService({
    storage, index, collections: [logCollection(logs)],
    allUserIds: async () => ['u1'], ageDays: overrides.ageDays ?? 30, destination: overrides.destination ?? DEST,
  });
  return { storage, logs, index, svc };
}

function objectKeyFor(userId: string, partition: string): string {
  return `${DEST}/extraction_logs/${userId}/${partition}.ndjson`;
}
function partitionNow(): string { return new Date().toISOString().slice(0, 7); }
async function readRows(storage: InMemoryStorage, key: string) {
  return dec.decode(await storage.get(key)).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('[TRAINING-ARCHIVE] archive then remove — never delete by age', () => {
  it('writes the object, indexes it, THEN removes the hot rows; rows read back carry their prompt version', async () => {
    const { storage, logs, index, svc } = build();
    await logs.log('u1', logRow('n1'));
    await logs.log('u1', logRow('n2'));

    const r = await svc.archive(Date.now() + 100 * DAY); // far ahead → both rows past the age window
    expect(r.enabled).toBe(true);
    expect(r.archived).toBe(2);

    // Hot table emptied only after the archive existed.
    expect(await logs.listByUser('u1')).toHaveLength(0);
    const key = objectKeyFor('u1', partitionNow());
    expect(await storage.exists(key)).toBe(true);
    const archived = await readRows(storage, key);
    expect(archived).toHaveLength(2);
    expect(archived[0].promptVersion).toBe('tovira-extract-v0.9.4'); // loadable for training later
    expect((await index.listByUser('u1'))[0]!.rowCount).toBe(2);
  });

  it('is disabled by default (ageDays 0) and with no destination — archives nothing, deletes nothing', async () => {
    const a = build({ ageDays: 0 });
    await a.logs.log('u1', logRow('n1'));
    expect((await a.svc.archive(Date.now() + 100 * DAY)).enabled).toBe(false);
    expect(await a.logs.listByUser('u1')).toHaveLength(1); // untouched

    const b = build({ destination: '' });
    await b.logs.log('u1', logRow('n1'));
    expect((await b.svc.archive(Date.now() + 100 * DAY)).enabled).toBe(false);
    expect(await b.logs.listByUser('u1')).toHaveLength(1);
  });

  it('a repeated run duplicates nothing', async () => {
    const { storage, logs, svc } = build();
    await logs.log('u1', logRow('n1'));
    await svc.archive(Date.now() + 100 * DAY);
    await svc.archive(Date.now() + 100 * DAY); // second run: nothing hot left
    const archived = await readRows(storage, objectKeyFor('u1', partitionNow()));
    expect(archived).toHaveLength(1); // not 2
  });

  it('an interrupted run (write succeeds, delete fails) loses nothing and does not duplicate on retry', async () => {
    const storage = new InMemoryStorage();
    const logs = new InMemoryExtractionLogRepository();
    const index = new InMemoryArchiveIndexRepository();
    await logs.log('u1', logRow('n1'));
    await logs.log('u1', logRow('n2'));

    let failDelete = true;
    const flaky: ArchivableCollection<ArchivableRecord> = {
      name: 'extraction_logs',
      listOlderThan: (u, c) => logs.listOlderThan(u, c) as unknown as Promise<ArchivableRecord[]>,
      deleteByIds: async (u, ids) => {
        if (failDelete) throw new Error('crash after archive write, before delete');
        return logs.deleteByIds(u, ids);
      },
    };
    const svc = new TrainingArchiveService({ storage, index, collections: [flaky], allUserIds: async () => ['u1'], ageDays: 30, destination: DEST });

    // First run crashes during delete — but the object was already written (verify-before-remove).
    await expect(svc.archive(Date.now() + 100 * DAY)).rejects.toThrow();
    const key = objectKeyFor('u1', partitionNow());
    expect(await storage.exists(key)).toBe(true);
    expect(await logs.listByUser('u1')).toHaveLength(2); // NOTHING lost — rows still hot

    // Retry succeeds: rows archived once (merged by id → no dup) and removed.
    failDelete = false;
    await svc.archive(Date.now() + 100 * DAY);
    expect(await logs.listByUser('u1')).toHaveLength(0);
    expect(await readRows(storage, key)).toHaveLength(2); // still 2, not 4
  });
});
