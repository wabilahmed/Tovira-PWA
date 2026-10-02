import { describe, it, expect } from 'vitest';
import { ErasureService } from './erasure-service.js';
import { ErasureRequestService } from './erasure-request-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../../adapters/storage/in-memory.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';
import { InMemoryErasureRequestRepository } from '../../adapters/erasure/in-memory-erasure-request-repository.js';
import { InMemoryErasureReceiptRepository } from '../../adapters/erasure/in-memory-erasure-receipt-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';

/**
 * [ERASURE Task 3] Erasure reaches audio the same way account deletion does. A voice recording WHOLLY
 * about the erased counterparty (the note's client IS the erased party) is deleted; a recording that is
 * not wholly theirs is left (it ages out within AUDIO_RETENTION_DAYS regardless, and over-deleting would
 * destroy the rep's own record of a meeting that involved other people). The receipt records whether a
 * recording was deleted now or had already expired.
 */

const NOW = Date.parse('2026-09-20T09:00:00Z');

function makeErasure(opts: {
  clients: InMemoryClientRepository;
  notes: InMemoryNoteRepository;
  blobStorage: { delete: (key: string) => Promise<void> };
}) {
  return new ErasureService({
    clients: opts.clients,
    notes: opts.notes,
    audit: new InMemoryErasureAuditRepository(),
    blobStorage: opts.blobStorage,
    now: () => NOW,
  });
}

describe('[ERASURE Task 3] erasure reaches audio', () => {
  it('deletes the recording when the note is WHOLLY about the erased party (its client IS the erased party)', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    const c = await clients.create('u', 'Zelda Quorn'); // the client itself is the erased counterparty
    await storage.put('audio/u/z.webm', new Uint8Array([1, 2, 3]));
    const n = await notes.create('u', { clientId: c.id, source: 'voice', audioKey: 'audio/u/z.webm', status: 'extracted', rawText: 'voice memo' });
    await notes.update('u', n.id, { transcribedAt: NOW }); // transcribed, recording still present

    const result = await makeErasure({ clients, notes, blobStorage: storage }).commit('u', ['Zelda Quorn']);

    expect(await storage.exists('audio/u/z.webm')).toBe(false); // recording deleted
    expect(result.categories.find((x) => x.category === 'recordings_deleted')?.deleted).toBe(1);
    const after = await notes.findByIdForUser('u', n.id);
    expect(after?.audioKey).toBeNull(); // row no longer points at it
    expect(after?.audioExpiredAt).toBe(NOW); // marked, so playback reports "no longer kept"
    expect(after?.rawText).toBe('voice memo'); // transcript untouched
  });

  // NEGATIVE: a recording that is NOT wholly about the erased party (filed under a different client; the
  // erased party is only a mentioned person) is LEFT ALONE — it ages out within the retention window.
  it('leaves a multi-party recording alone (note filed under a different client)', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    const c = await clients.create('u', 'Marina Estates'); // the client is NOT the erased party
    await storage.put('audio/u/m.webm', new Uint8Array([4, 5, 6]));
    const n = await notes.create('u', { clientId: c.id, source: 'voice', audioKey: 'audio/u/m.webm', status: 'extracted', rawText: 'memo about the deal' });
    await notes.update('u', n.id, {
      transcribedAt: NOW,
      extracted: { summary: 's', people: [{ name: 'Zelda Quorn', role: null, reports_to: null, decision_role: 'unknown', notes: null }], personal_facts: [], promises: [], key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [] },
    });

    const result = await makeErasure({ clients, notes, blobStorage: storage }).commit('u', ['Zelda Quorn']);

    expect(await storage.exists('audio/u/m.webm')).toBe(true); // recording KEPT — ages out within 30d
    expect(result.categories.find((x) => x.category === 'recordings_deleted')).toBeUndefined();
    // sanity: the mentioned person was still erased from the structured facts
    expect((await notes.findByIdForUser('u', n.id))!.audioKey).toBe('audio/u/m.webm');
    expect(((await notes.findByIdForUser('u', n.id))!.extracted as { people: unknown[] }).people).toHaveLength(0);
  });

  // The recording was already deleted by the 30-day retention sweep before the erasure ran. The receipt
  // must still be accurate: it records that a recording had ALREADY expired, and issues no delete.
  it('records an already-expired recording as such, and deletes nothing', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const deleted: string[] = [];
    const c = await clients.create('u', 'Zelda Quorn');
    const n = await notes.create('u', { clientId: c.id, source: 'voice', audioKey: null, status: 'extracted', rawText: 'voice memo' });
    await notes.update('u', n.id, { transcribedAt: NOW - 90 * 86_400_000, audioExpiredAt: NOW - 60 * 86_400_000 }); // aged out already

    const result = await makeErasure({ clients, notes, blobStorage: { delete: async (k) => { deleted.push(k); } } }).commit('u', ['Zelda Quorn']);

    expect(deleted).toEqual([]); // nothing to delete
    expect(result.categories.find((x) => x.category === 'recordings_already_expired')?.deleted).toBe(1);
    expect(result.categories.find((x) => x.category === 'recordings_deleted')).toBeUndefined();
  });

  // The erasure RECEIPT (durable proof) must carry the recording outcome so completion is accurate.
  it('the erasure receipt records that a recording was deleted', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const storage = new InMemoryStorage();
    const receipts = new InMemoryErasureReceiptRepository();
    const now = { t: NOW };
    const c = await clients.create('u', 'Zelda Quorn');
    await storage.put('audio/u/z.webm', new Uint8Array([1, 2, 3]));
    const n = await notes.create('u', { clientId: c.id, source: 'voice', audioKey: 'audio/u/z.webm', status: 'extracted', rawText: 'voice memo' });
    await notes.update('u', n.id, { transcribedAt: NOW });

    const erasure = new ErasureService({ clients, notes, audit: new InMemoryErasureAuditRepository(), blobStorage: storage, now: () => now.t });
    const svc = new ErasureRequestService({ erasure, requests: new InMemoryErasureRequestRepository(), receipts, notifications: new InMemoryNotificationRepository(), dispatch: async () => {}, now: () => now.t });

    const req = await svc.open('u', ['Zelda Quorn']);
    now.t = Date.parse('2026-10-10T00:00:00Z'); // window elapsed
    const done = await svc.complete('u', req.id);
    expect(done.ok).toBe(true);

    const r = (await receipts.list())[0]!;
    expect(r.categories.find((x) => x.category === 'recordings_deleted')?.deleted).toBe(1);
    // no requester name / content leaks via the new category (shape-only {category, deleted})
    expect(JSON.stringify(r)).not.toMatch(/Zelda/i);
  });
});
