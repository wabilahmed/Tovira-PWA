import { describe, it, expect } from 'vitest';
import { ErasureService } from './erasure-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';
import { InMemoryStorage } from '../../adapters/storage/in-memory.js';
import { InMemoryArchiveIndexRepository } from '../../adapters/logs/in-memory-archive-index-repository.js';

/**
 * [ERASURE-ARCHIVE Task 2] The training archive (object storage) is covered by the SAME preview →
 * commit flow: a row ABOUT the requester (exact who-field in its rawOutput) is purged whole; a fuzzy
 * row waits for operator confirmation; a mention-only row survives whole.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const KEY = 'training-archive/extraction_logs/u/2026-01.ndjson';
const KEY_B = 'training-archive/extraction_logs/b/2026-01.ndjson';

const row = (id: string, noteId: string, rawOutput: object, input = 'chat text') => ({ id, noteId, input, rawOutput: JSON.stringify(rawOutput), status: 'extracted' });
const ARCHIVE_ROWS = [
  row('r-exact', 'n1', { people: [], personal_facts: [{ subject: 'Khalid', fact: 'has five million' }], unanswered_questions: [] }),
  row('r-fuzzy', 'n2', { people: [{ name: 'Khalid Rahman' }], personal_facts: [], unanswered_questions: [] }),
  row('r-mention', 'n3', { people: [{ name: 'Layla' }], personal_facts: [], unanswered_questions: [], summary: 'Layla wants it; Khalid wants to see it too' }, 'Layla: book it'),
  row('r-none', 'n4', { people: [{ name: 'Sara' }], personal_facts: [] }, 'unrelated'),
];

async function make() {
  const storage = new InMemoryStorage();
  const archiveIndex = new InMemoryArchiveIndexRepository();
  const svc = new ErasureService({ clients: new InMemoryClientRepository(), notes: new InMemoryNoteRepository(), extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository(), archiveIndex, archiveStorage: storage });
  await storage.put(KEY, enc.encode(ARCHIVE_ROWS.map((r) => JSON.stringify(r)).join('\n') + '\n'));
  await archiveIndex.upsert('u', { collection: 'extraction_logs', partition: '2026-01', objectKey: KEY, rowCount: ARCHIVE_ROWS.length });
  return { svc, storage, archiveIndex };
}
async function ids(storage: InMemoryStorage, key: string): Promise<string[]> {
  const text = dec.decode(await storage.get(key)).trim();
  return text ? text.split('\n').map((l) => (JSON.parse(l) as { id: string }).id) : [];
}

describe('[ERASURE-ARCHIVE Task 2] archive purge in the erasure flow', () => {
  it('an exact-match archive row is purged on commit; fuzzy and mention survive', async () => {
    const { svc, storage } = await make();
    await svc.commit('u', ['Khalid']);
    expect(await ids(storage, KEY)).toEqual(['r-fuzzy', 'r-mention', 'r-none']); // r-exact gone; fuzzy NOT purged
  });

  it('a fuzzy-match archive row is purged ONLY when the operator confirms it', async () => {
    const { svc, storage } = await make();
    await svc.commit('u', ['Khalid'], { confirmArchiveRows: [{ objectKey: KEY, rowId: 'r-fuzzy' }] });
    expect(await ids(storage, KEY)).toEqual(['r-mention', 'r-none']); // exact + confirmed fuzzy gone; mention survives
  });

  it('the preview lists archive rows ALONGSIDE DB rows (one list)', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    const archiveIndex = new InMemoryArchiveIndexRepository();
    const svc = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository(), archiveIndex, archiveStorage: storage });
    await storage.put(KEY, enc.encode(ARCHIVE_ROWS.map((r) => JSON.stringify(r)).join('\n') + '\n'));
    await archiveIndex.upsert('u', { collection: 'extraction_logs', partition: '2026-01', objectKey: KEY, rowCount: ARCHIVE_ROWS.length });
    const c = await clients.create('u', 'Marina');
    const n = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: 'x', messages: [] });
    await notes.update('u', n.id, { extracted: { people: [{ name: 'Khalid', role: null, reports_to: null, decision_role: 'unknown', notes: null }], personal_facts: [], promises: [], key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [] } });
    const plan = await svc.preview('u', ['Khalid']);
    expect(plan.autoDelete.some((i) => i.store === 'people')).toBe(true); // DB row
    expect(plan.autoDelete.some((i) => i.store === 'archive')).toBe(true); // archive row — same list
    expect(plan.fuzzyCandidates.some((i) => i.store === 'archive' && i.rowId === 'r-fuzzy')).toBe(true);
    expect(plan.keptMentions.some((m) => m.store.startsWith('archive:'))).toBe(true);
  });

  it('purging is idempotent — re-running commits nothing extra', async () => {
    const { svc, storage } = await make();
    await svc.commit('u', ['Khalid']);
    const afterFirst = await ids(storage, KEY);
    const res2 = await svc.commit('u', ['Khalid']);
    expect(await ids(storage, KEY)).toEqual(afterFirst); // unchanged
    expect(res2.categories.find((c) => c.category === 'training_archive')).toBeUndefined(); // nothing purged the 2nd time
  });

  it("cross-account: purging one account's archive never touches another's", async () => {
    const { svc, storage, archiveIndex } = await make();
    await storage.put(KEY_B, enc.encode(ARCHIVE_ROWS.map((r) => JSON.stringify(r)).join('\n') + '\n'));
    await archiveIndex.upsert('b', { collection: 'extraction_logs', partition: '2026-01', objectKey: KEY_B, rowCount: ARCHIVE_ROWS.length });
    await svc.commit('u', ['Khalid']);
    expect(await ids(storage, KEY_B)).toEqual(['r-exact', 'r-fuzzy', 'r-mention', 'r-none']); // account b untouched
  });

  it('the commit result counts the archive rows purged', async () => {
    const { svc } = await make();
    const res = await svc.commit('u', ['Khalid']);
    expect(res.categories.find((c) => c.category === 'training_archive')!.deleted).toBe(1); // r-exact
  });
});
