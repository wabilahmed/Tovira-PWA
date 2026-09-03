import { describe, it, expect } from 'vitest';
import { InventoryService } from './inventory-service.js';
import { InMemoryInventoryRepository } from '../../adapters/inventory/in-memory-inventory-repository.js';
import type { Embedder } from '../../ports/embedder.js';

const USER = '11111111-1111-1111-1111-111111111111';

/** A spy embedder — counts calls and can be made to fail. No Claude anywhere near this. */
function spyEmbedder(fail = false): Embedder & { calls: number } {
  return {
    dimension: 4,
    calls: 0,
    async embed(this: { calls: number }): Promise<number[]> {
      this.calls += 1;
      if (fail) throw new Error('bedrock down');
      return [0.1, 0.2, 0.3, 0.4];
    },
  };
}

describe('InventoryService', () => {
  it('embeds title+description on create (one Bedrock call), item marked embedded', async () => {
    const emb = spyEmbedder();
    const svc = new InventoryService(new InMemoryInventoryRepository(), emb);
    const item = await svc.create(USER, { title: 'Marina 2-bed', description: 'sea view', quantity: 1 });
    expect(emb.calls).toBe(1);
    expect(item.embedded).toBe(true);
  });

  it('embedding is best-effort — a failure still saves the item (never lose the record)', async () => {
    const svc = new InventoryService(new InMemoryInventoryRepository(), spyEmbedder(true));
    const item = await svc.create(USER, { title: 't', description: 'd', quantity: 1 });
    expect(item.embedded).toBe(false); // saved without a vector; matching re-embeds later
  });

  it('re-embeds only when the matching surface (title/description) changes', async () => {
    const emb = spyEmbedder();
    const svc = new InventoryService(new InMemoryInventoryRepository(), emb);
    const item = await svc.create(USER, { title: 't', description: 'd', quantity: 1 });
    expect(emb.calls).toBe(1);
    await svc.edit(USER, item.id, { quantity: 5 });       // quantity only → no re-embed
    expect(emb.calls).toBe(1);
    await svc.edit(USER, item.id, { description: 'new' }); // description → re-embed
    expect(emb.calls).toBe(2);
  });

  it('quantity 0 disables as unlisted; back above 0 reactivates, clearing the reason', async () => {
    const svc = new InventoryService(new InMemoryInventoryRepository(), spyEmbedder());
    const item = await svc.create(USER, { title: 't', description: 'd', quantity: 2 });
    const off = await svc.edit(USER, item.id, { quantity: 0 });
    expect(off!.status).toBe('disabled');
    expect(off!.disabledReason).toBe('unlisted');
    const on = await svc.edit(USER, item.id, { quantity: 4 });
    expect(on!.status).toBe('active');
    expect(on!.disabledReason).toBeNull();
    expect(on!.createdAt).toBe(item.createdAt); // same item, preserved
  });

  it('editing a foreign item returns null (no cross-tenant write)', async () => {
    const svc = new InventoryService(new InMemoryInventoryRepository(), spyEmbedder());
    const item = await svc.create(USER, { title: 't', description: 'd', quantity: 1 });
    expect(await svc.edit('22222222-2222-2222-2222-222222222222', item.id, { title: 'x' })).toBeNull();
  });
});
