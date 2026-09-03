import { describe, it, expect } from 'vitest';
import { InMemoryInventoryRepository } from './in-memory-inventory-repository.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('InMemoryInventoryRepository — port contract', () => {
  it('creates an active item, records whether it was embedded, newest-first list', async () => {
    const repo = new InMemoryInventoryRepository();
    await repo.create(A, { title: 'first', description: 'd', quantity: 1, embedding: null });
    const second = await repo.create(A, { title: 'second', description: 'd', quantity: 3, embedding: [0.1, 0.2] });
    const items = await repo.listByUser(A);
    expect(items.map((i) => i.title)).toEqual(['second', 'first']); // newest first
    expect(items[0]!.status).toBe('active');
    expect(items[0]!.embedded).toBe(true);
    expect(items[1]!.embedded).toBe(false);
    expect(second.quantity).toBe(3);
  });

  it('scopes reads to the owner (foreign id → null)', async () => {
    const repo = new InMemoryInventoryRepository();
    const item = await repo.create(A, { title: 'a', description: 'd', quantity: 1, embedding: null });
    expect(await repo.findByIdForUser(A, item.id)).not.toBeNull();
    expect(await repo.findByIdForUser(B, item.id)).toBeNull();
    expect(await repo.listByUser(B)).toEqual([]);
  });

  it('filters list by status', async () => {
    const repo = new InMemoryInventoryRepository();
    const item = await repo.create(A, { title: 'a', description: 'd', quantity: 1, embedding: null });
    await repo.update(A, item.id, { status: 'disabled', disabledReason: 'unlisted', quantity: 0 });
    expect((await repo.listByUser(A, 'active'))).toHaveLength(0);
    expect((await repo.listByUser(A, 'disabled'))).toHaveLength(1);
    expect((await repo.listByUser(A))).toHaveLength(1);
  });

  it('update patches only what is given; a foreign update is a no-op returning null', async () => {
    const repo = new InMemoryInventoryRepository();
    const item = await repo.create(A, { title: 'a', description: 'd', quantity: 1, embedding: null });
    const updated = await repo.update(A, item.id, { title: 'renamed' });
    expect(updated!.title).toBe('renamed');
    expect(updated!.description).toBe('d');
    expect(await repo.update(B, item.id, { title: 'hijack' })).toBeNull();
    expect((await repo.findByIdForUser(A, item.id))!.title).toBe('renamed'); // untouched by B
  });

  it('purgeUser removes only that user\'s items (account deletion)', async () => {
    const repo = new InMemoryInventoryRepository();
    await repo.create(A, { title: 'a', description: 'd', quantity: 1, embedding: null });
    await repo.create(B, { title: 'b', description: 'd', quantity: 1, embedding: null });
    await repo.purgeUser(A);
    expect(await repo.listByUser(A)).toEqual([]);
    expect(await repo.listByUser(B)).toHaveLength(1);
  });
});
