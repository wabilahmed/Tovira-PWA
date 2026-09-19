import { describe, it, expect } from 'vitest';
import { ErasureService } from './erasure-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [ERASURE Task 3] Note embeddings are one vector over the whole rawText (all speakers), so they
 * cannot be attributed to one speaker. Rule-compliant behaviour: clear the embedding ONLY for a note
 * wholly the requester's; leave a shared note's vector (a reported residual) rather than over-delete.
 */

function make() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const svc = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository() });
  return { clients, notes, svc };
}
const msg = (sender: string, body: string): ImportedMessage => ({ sentAt: '2026-01-01T10:00:00', sender, body, media: false, role: 'unknown' });

describe('[ERASURE Task 3] embeddings', () => {
  it("clears the embedding of a note WHOLLY the requester's (no survivors)", async () => {
    const { clients, notes, svc } = make();
    const c = await clients.create('u', 'Marina Estates');
    const n = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: 'Khalid: hi', messages: [msg('Khalid', 'hi'), msg('Khalid', 'still there?')] });
    await notes.update('u', n.id, { embedding: [0.1, 0.2, 0.3], extracted: { people: [], personal_facts: [], promises: [], key_dates: [], concerns: [], next_steps: [], meeting: null } });
    expect((await notes.searchSimilarByUser('u', [0.1, 0.2, 0.3], 5)).some((r) => r.note.id === n.id)).toBe(true); // searchable before
    await svc.commit('u', ['Khalid']);
    const after = await notes.findByIdForUser('u', n.id);
    expect(after!.messages).toHaveLength(0); // all messages were the requester's
    // The vector was entirely their content → cleared → the note drops out of semantic recall.
    expect((await notes.searchSimilarByUser('u', [0.1, 0.2, 0.3], 5)).some((r) => r.note.id === n.id)).toBe(false);
  });

  it('RETAINS a SHARED note\'s embedding (cannot clear one speaker without re-embedding) — reported residual', async () => {
    const { clients, notes, svc } = make();
    const c = await clients.create('u', 'Marina Estates');
    const n = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: 'x', messages: [msg('Khalid', 'i have five million'), msg('Layla', 'book the viewing')] });
    await notes.update('u', n.id, { embedding: [0.4, 0.5, 0.6], extracted: { people: [], personal_facts: [], promises: [], key_dates: [], concerns: [], next_steps: [], meeting: null } });
    await svc.commit('u', ['Khalid']);
    const after = await notes.findByIdForUser('u', n.id);
    expect(after!.messages!.map((m) => m.sender)).toEqual(['Layla']); // requester's message removed
    // Vector NOT cleared — clearing would drop recall for the KEPT facts; the note stays searchable.
    expect((await notes.searchSimilarByUser('u', [0.4, 0.5, 0.6], 5)).some((r) => r.note.id === n.id)).toBe(true);
  });
});
