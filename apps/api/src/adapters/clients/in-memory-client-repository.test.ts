import { describe, it, expect } from 'vitest';
import { InMemoryClientRepository } from './in-memory-client-repository.js';

// [P0-4] The in-memory repo mirrors the isolation contract RLS enforces in
// Postgres: a rep only ever sees their own clients.
describe('InMemoryClientRepository', () => {
  it('creates a client owned by the caller and lists it back', async () => {
    const repo = new InMemoryClientRepository();
    const created = await repo.create('user-A', 'Meridian Corp');
    expect(created.userId).toBe('user-A');
    expect(created.name).toBe('Meridian Corp');
    const list = await repo.listByUser('user-A');
    expect(list.map((c) => c.id)).toContain(created.id);
  });

  // [FLOWS-9] a scanned card's title + email persist on the client record.
  it('stores the optional title and email verbatim (null by default)', async () => {
    const repo = new InMemoryClientRepository();
    const withCard = await repo.create('user-A', 'Jane Doe', '+971 50 123 4567', 'CTO', 'jane@acme.ae');
    expect(withCard.title).toBe('CTO');
    expect(withCard.email).toBe('jane@acme.ae');
    const plain = await repo.create('user-A', 'No Card');
    expect(plain.title).toBeNull();
    expect(plain.email).toBeNull();
  });

  it('never returns another user\'s clients in a list', async () => {
    const repo = new InMemoryClientRepository();
    await repo.create('user-A', 'A Corp');
    expect(await repo.listByUser('user-B')).toEqual([]);
  });

  it('findByIdForUser returns null for a client owned by someone else (IDOR guard)', async () => {
    const repo = new InMemoryClientRepository();
    const a = await repo.create('user-A', 'A Corp');
    expect(await repo.findByIdForUser('user-A', a.id)).not.toBeNull();
    expect(await repo.findByIdForUser('user-B', a.id)).toBeNull();
  });

  // [P4-7] optional phone: stored as-is at create, editable later, tenant-scoped.
  it('stores an optional phone at create and defaults it to null', async () => {
    const repo = new InMemoryClientRepository();
    const withPhone = await repo.create('user-A', 'A Corp', '+971 50 123 4567');
    expect(withPhone.phone).toBe('+971 50 123 4567');
    const without = await repo.create('user-A', 'B Corp');
    expect(without.phone).toBeNull();
  });

  it('sets a client phone later, scoped to the owner', async () => {
    const repo = new InMemoryClientRepository();
    const a = await repo.create('user-A', 'A Corp');
    await repo.setPhone('user-A', a.id, '+971501234567');
    expect((await repo.findByIdForUser('user-A', a.id))!.phone).toBe('+971501234567');
  });

  it('never lets another rep set or read a client phone (isolation)', async () => {
    const repo = new InMemoryClientRepository();
    const a = await repo.create('user-A', 'A Corp', '+971501234567');
    await repo.setPhone('user-B', a.id, '+10000000000'); // wrong owner → no-op
    expect((await repo.findByIdForUser('user-A', a.id))!.phone).toBe('+971501234567');
    expect(await repo.findByIdForUser('user-B', a.id)).toBeNull();
  });

  // [P1-2] recents-first ordering and search.
  it('lists most-recently-touched clients first', async () => {
    const repo = new InMemoryClientRepository();
    const first = await repo.create('user-A', 'First');
    const second = await repo.create('user-A', 'Second');
    expect((await repo.listByUser('user-A')).map((c) => c.id)).toEqual([second.id, first.id]);
  });

  it('touch() bumps a client to the top of the list', async () => {
    const repo = new InMemoryClientRepository();
    const first = await repo.create('user-A', 'First');
    await repo.create('user-A', 'Second');
    await repo.touch('user-A', first.id);
    expect((await repo.listByUser('user-A'))[0]!.id).toBe(first.id);
  });

  it('search matches by name case-insensitively, scoped to the user', async () => {
    const repo = new InMemoryClientRepository();
    await repo.create('user-A', 'Meridian Corp');
    await repo.create('user-A', 'Northwind');
    await repo.create('user-B', 'Meridian Ltd');
    const hits = await repo.search('user-A', 'meri');
    expect(hits.map((c) => c.name)).toEqual(['Meridian Corp']);
  });

  it('search with no matches returns an empty list (not an error)', async () => {
    const repo = new InMemoryClientRepository();
    await repo.create('user-A', 'Meridian Corp');
    expect(await repo.search('user-A', 'zzz')).toEqual([]);
  });

  it('stays correct with many clients (search filters, does not choke)', async () => {
    const repo = new InMemoryClientRepository();
    for (let i = 0; i < 600; i++) await repo.create('user-A', `Client ${i}`);
    await repo.create('user-A', 'Needle Corp');
    const hits = await repo.search('user-A', 'needle');
    expect(hits.map((c) => c.name)).toEqual(['Needle Corp']);
  });
});
