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
});
