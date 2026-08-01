import { describe, it, expect } from 'vitest';
import { CorpusStatsService } from './corpus-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

const msg = (sentAt: string): ImportedMessage => ({ sentAt, sender: 'Sara', body: 'x', media: false, role: 'client' });

async function setup() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const svc = new CorpusStatsService(clients, notes);
  const client = await clients.create('u1', 'Acme');
  return { clients, notes, svc, clientId: client.id };
}

describe('CorpusStatsService (P4-10)', () => {
  it('measures the month span from imported history (Jan → Apr = 3)', async () => {
    const { notes, svc, clientId } = await setup();
    await notes.create('u1', {
      clientId, source: 'whatsapp_export', rawText: 't', audioKey: null, status: 'extracted',
      messages: [msg('2026-01-15T09:00:00'), msg('2026-02-20T09:00:00'), msg('2026-04-15T09:00:00')],
    });
    const stats = await svc.compute('u1');
    expect(stats.moments).toBe(3);
    expect(stats.months).toBe(3);
  });

  it('counts every message and every note as a moment', async () => {
    const { notes, svc, clientId } = await setup();
    await notes.create('u1', {
      clientId, source: 'whatsapp_export', rawText: 't', audioKey: null, status: 'extracted',
      messages: [msg('2026-01-15T09:00:00'), msg('2026-02-20T09:00:00'), msg('2026-04-15T09:00:00')],
    });
    await notes.create('u1', { clientId, source: 'paste', rawText: 'a', audioKey: null, status: 'extracted' });
    await notes.create('u1', { clientId, source: 'voice', rawText: 'b', audioKey: null, status: 'extracted' });
    expect((await svc.compute('u1')).moments).toBe(5); // 3 messages + 2 notes
  });

  it('returns zero for an empty account', async () => {
    const { svc } = await setup();
    expect(await svc.compute('u1')).toEqual({ months: 0, moments: 0 });
  });

  // NEVER INFLATES: a failed import contributes nothing.
  it('does not count a failed import', async () => {
    const { notes, svc, clientId } = await setup();
    await notes.create('u1', { clientId, source: 'whatsapp_export', rawText: 'garbage', audioKey: null, status: 'import_failed' });
    expect((await svc.compute('u1')).moments).toBe(0);
  });

  // NEVER INFLATES: recomputed from stored data, so removing content decrements it.
  it('reflects current data (no cached counter)', async () => {
    const { notes, svc, clientId } = await setup();
    const n = await notes.create('u1', { clientId, source: 'paste', rawText: 'a', audioKey: null, status: 'extracted' });
    expect((await svc.compute('u1')).moments).toBe(1);
    await notes.update('u1', n.id, { status: 'import_failed' }); // simulate content becoming uncounted
    expect((await svc.compute('u1')).moments).toBe(0);
  });

  it('is tenant-scoped', async () => {
    const { notes, svc, clientId } = await setup();
    await notes.create('u1', { clientId, source: 'paste', rawText: 'a', audioKey: null, status: 'extracted' });
    expect(await svc.compute('other-user')).toEqual({ months: 0, moments: 0 });
  });
});
