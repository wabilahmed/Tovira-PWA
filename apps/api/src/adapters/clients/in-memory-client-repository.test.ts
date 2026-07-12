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
