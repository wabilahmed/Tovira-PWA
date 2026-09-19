import { describe, it, expect } from 'vitest';
import { ErasureService } from './erasure-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';
import { InMemoryStorage } from '../../adapters/storage/in-memory.js';
import { InMemoryArchiveIndexRepository } from '../../adapters/logs/in-memory-archive-index-repository.js';

/**
 * [ERASURE-ARCHIVE Task 3] The audit must PROVE the archive was covered — a category count — without
 * itself becoming a copy of what was deleted (no content, no quotes).
 */

const enc = new TextEncoder();
const KEY = 'training-archive/extraction_logs/u/2026-01.ndjson';
// An archived row ABOUT Khalid, whose content ("has five million") must NOT end up in the audit.
const ROW = { id: 'r1', noteId: 'n1', input: 'Khalid: I have five million ready', rawOutput: JSON.stringify({ people: [], personal_facts: [{ subject: 'Khalid', fact: 'has five million ready' }], unanswered_questions: [] }), status: 'extracted' };

async function make() {
  const audit = new InMemoryErasureAuditRepository();
  const storage = new InMemoryStorage();
  const archiveIndex = new InMemoryArchiveIndexRepository();
  const svc = new ErasureService({ clients: new InMemoryClientRepository(), notes: new InMemoryNoteRepository(), extractionLog: new InMemoryExtractionLogRepository(), audit, archiveIndex, archiveStorage: storage });
  await storage.put(KEY, enc.encode(JSON.stringify(ROW) + '\n'));
  await archiveIndex.upsert('u', { collection: 'extraction_logs', partition: '2026-01', objectKey: KEY, rowCount: 1 });
  return { svc, audit };
}

describe('[ERASURE-ARCHIVE Task 3] audit', () => {
  it("a completed erasure's audit shows the archive category + count", async () => {
    const { svc, audit } = await make();
    await svc.commit('u', ['Khalid']);
    const [rec] = await audit.listByUser('u');
    const arch = rec!.categories.find((c) => c.category === 'training_archive');
    expect(arch).toBeTruthy(); // an auditor can confirm the archive was included
    expect(arch!.deleted).toBe(1);
  });

  it('the audit contains NO erased content — only the request subject + category counts', async () => {
    const { svc, audit } = await make();
    await svc.commit('u', ['Khalid']);
    const [rec] = await audit.listByUser('u');
    const blob = JSON.stringify(rec);
    expect(blob).not.toContain('five million'); // the erased fact text
    expect(blob).not.toContain('rawOutput'); // no archived row
    expect(blob).not.toContain('r1'); // no row id
    expect(rec!.requesterNames).toEqual(['Khalid']); // request metadata only (who), needed for the window
  });
});
