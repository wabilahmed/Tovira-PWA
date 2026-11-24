import { describe, it, expect } from 'vitest';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import { InMemoryImageRepository } from '../../adapters/images/in-memory-image-repository.js';
import { listForClients } from './list-for-clients.js';
import { restrictingNotes, restrictingRequirements } from '../erasure/surface-filter.js';
import { restrictionForNames } from '../erasure/restriction.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P86 · index audit] One query for "every client's notes" instead of one per client (the N+1 the audit found in the
 * client list, Today, Find, Book Scan, recall, Monday, the scan, the corpus, the export, erasure and misfile
 * detection). The batched read must return exactly what the per-client read returns, client by client, and a
 * restricted view must withhold exactly what it withholds per client: the batch is a speed-up, never a new door.
 */
const msg = (sender: string, body: string): ImportedMessage => ({ sentAt: '2026-11-01T10:00', sender, body, media: false, role: sender === 'Me' ? 'rep' : 'client' });

/** An in-memory repository with the batched read the Postgres one has (its SQL is proven against real Postgres in
 *  db/batched-writes-real-postgres.test.ts; the in-memory repositories sit in the extraction gate's graph and are left
 *  as they are). */
function batched<T, R extends { listByClient(u: string, c: string): Promise<T[]> }>(repo: R): R & { listByClients(u: string, ids: string[]): Promise<Map<string, T[]>> } {
  return Object.assign(Object.create(repo) as R, {
    listByClients: async (u: string, ids: string[]) => new Map(await Promise.all(ids.map(async (id) => [id, await repo.listByClient(u, id)] as const))),
  }) as R & { listByClients(u: string, ids: string[]): Promise<Map<string, T[]>> };
}

async function book() {
  const notes = new InMemoryNoteRepository();
  await notes.create('u1', { clientId: 'c1', source: 'whatsapp_export', rawText: null, audioKey: null, status: 'extracted', messages: [msg('Khalid', 'my passport renewal'), msg('Me', 'noted')] });
  await notes.create('u1', { clientId: 'c1', source: 'paste', rawText: 'second', audioKey: null, status: 'extracted' });
  await notes.create('u1', { clientId: 'c1', source: 'paste', rawText: 'unconfirmed', audioKey: null, status: 'pending_confirmation' });
  await notes.create('u1', { clientId: 'c2', source: 'whatsapp_export', rawText: null, audioKey: null, status: 'extracted', messages: [msg('Sara', 'a 2-bed please')] });
  await notes.create('u2', { clientId: 'c1', source: 'paste', rawText: 'another tenant', audioKey: null, status: 'extracted' });
  return batched(notes);
}

describe('listByClients: one read for many clients', () => {
  it('images (in memory): same rows as the per-client read, tenant-scoped', async () => {
    const images = new InMemoryImageRepository();
    await images.create('u1', { clientId: 'c1', storageKey: 'k1', contentType: 'image/jpeg' });
    await images.create('u2', { clientId: 'c1', storageKey: 'k2', contentType: 'image/jpeg' });
    const ib = await images.listByClients('u1', ['c1', 'c2']);
    for (const id of ['c1', 'c2']) expect(ib.get(id)).toEqual(await images.listByClient('u1', id));
    expect(ib.get('c2')).toEqual([]);
  });

  it('listForClients uses the batched read once when the repository has it', async () => {
    const notes = await book();
    let perClient = 0;
    let batched = 0;
    const counting = {
      listByClient: async (u: string, c: string) => { perClient++; return notes.listByClient(u, c); },
      listByClients: async (u: string, ids: string[]) => { batched++; return notes.listByClients(u, ids); },
    };
    const got = await listForClients(counting, 'u1', ['c1', 'c2', 'c1']);
    expect(batched).toBe(1);
    expect(perClient).toBe(0);
    expect([...got.keys()]).toEqual(['c1', 'c2']);
  });

  it('listForClients still works for a repository that only reads one client at a time', async () => {
    const notes = await book();
    const plain = { listByClient: (u: string, c: string) => notes.listByClient(u, c) };
    const got = await listForClients(plain, 'u1', ['c1', 'c2']);
    expect(got.get('c1')).toEqual(await notes.listByClient('u1', 'c1'));
    expect(await listForClients(plain, 'u1', [])).toEqual(new Map());
  });

  it('a restricted notes view withholds the same in the batch as client by client', async () => {
    const notes = await book();
    const restriction = { forUser: async () => restrictionForNames(['Khalid']) };
    const view = restrictingNotes(notes, restriction);
    const batch = await view.listByClients('u1', ['c1', 'c2']);
    for (const id of ['c1', 'c2']) expect(batch.get(id)).toEqual(await view.listByClient('u1', id));
    expect(JSON.stringify(batch.get('c1'))).not.toContain('passport');
  });

  it('a restricted requirements view withholds the same in the batch as client by client', async () => {
    const notes = await book();
    const reqs = batched(new InMemoryRequirementRepository());
    const [n1] = await notes.listByClient('u1', 'c2');
    await reqs.saveForNote('u1', n1!.id, 'c2', [{ text: 'A 2-bed', requirementRaw: 'a 2-bed please', statedOn: null, confidence: 'high', embedding: null }]);
    const clients = { listByUser: async () => [{ id: 'c1', name: 'Khalid Noor' }, { id: 'c2', name: 'Sara Ali' }] };
    const restriction = { forUser: async () => restrictionForNames(['Sara Ali']) };
    const view = restrictingRequirements(reqs, restriction, notes, clients as never);
    const batch = await view.listByClients('u1', ['c1', 'c2']);
    for (const id of ['c1', 'c2']) expect(batch.get(id)).toEqual(await view.listByClient('u1', id));
    expect(batch.get('c2')).toEqual([]); // Sara's own words are withheld in the batch too
  });
});
