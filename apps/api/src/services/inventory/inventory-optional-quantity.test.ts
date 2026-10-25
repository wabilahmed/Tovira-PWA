import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InventoryService } from './inventory-service.js';
import { InMemoryInventoryRepository } from '../../adapters/inventory/in-memory-inventory-repository.js';
import { LedgerService } from '../ledger/ledger-service.js';
import { InMemoryLedgerRepository } from '../../adapters/ledger/in-memory-ledger-repository.js';
import type { Embedder } from '../../ports/embedder.js';

/**
 * [P43-4] Owner: quantity is optional. A plan, a role or a proposal has no stock count, so a blank quantity means
 * "not counted": never decremented, never auto-disabled, never an over-share warning. A set quantity keeps every
 * existing rule (0 disables; a purchase decrements; reaching 0 is out of stock).
 */
const U = '11111111-1111-1111-1111-111111111111';
const C = '22222222-2222-2222-2222-222222222222';
const embedder: Embedder = { dimension: 4, embed: async () => [0.1, 0.2, 0.3, 0.4] };
const svc = () => { const repo = new InMemoryInventoryRepository(); return { repo, s: new InventoryService(repo, embedder, new LedgerService(new InMemoryLedgerRepository())) }; };

describe('[P43-4] optional quantity', () => {
  it('an item can be created with no quantity: active, quantity null', async () => {
    const { s } = svc();
    const item = await s.create(U, { title: 'Premium plan', description: 'motor + medical', quantity: null });
    expect(item).toMatchObject({ quantity: null, status: 'active' });
  });

  it('a purchase never decrements or disables an uncounted item', async () => {
    const { s } = svc();
    const item = await s.create(U, { title: 'Premium plan', description: 'x', quantity: null });
    const r = await s.share(U, item.id, C);
    if (!r.ok) throw new Error('share failed');
    await s.setOutcome(U, r.share.id, 'bought', 1);
    expect(await s.get(U, item.id)).toMatchObject({ quantity: null, status: 'active', disabledReason: null });
  });

  it('NEGATIVE: an uncounted item never warns about over-sharing', async () => {
    const { s } = svc();
    const item = await s.create(U, { title: 'Premium plan', description: 'x', quantity: null });
    await s.share(U, item.id, C);
    const second = await s.share(U, item.id, '33333333-3333-3333-3333-333333333333');
    expect(second.ok && second.warning).toBeNull();
  });

  it('clearing the quantity of a disabled item makes it available again; setting 0 still disables', async () => {
    const { s } = svc();
    const item = await s.create(U, { title: 'Unit 402', description: 'x', quantity: 1 });
    expect(await s.edit(U, item.id, { quantity: 0 })).toMatchObject({ status: 'disabled', disabledReason: 'unlisted' });
    expect(await s.edit(U, item.id, { quantity: null })).toMatchObject({ quantity: null, status: 'active', disabledReason: null });
  });

  it('a counted item keeps the rules: the last one bought is out of stock', async () => {
    const { s } = svc();
    const item = await s.create(U, { title: 'Unit 402', description: 'x', quantity: 1 });
    const r = await s.share(U, item.id, C);
    if (!r.ok) throw new Error('share failed');
    await s.setOutcome(U, r.share.id, 'bought', 1);
    expect(await s.get(U, item.id)).toMatchObject({ quantity: 0, status: 'disabled', disabledReason: 'sold_out' });
  });

  it('migration 0096 makes quantity nullable with no default, keeps the >= 0 check, and backfills nothing', () => {
    const sql = readFileSync(fileURLToPath(new URL('../../../migrations/0096_inventory_quantity_optional.sql', import.meta.url)), 'utf8');
    expect(sql).toMatch(/ALTER TABLE inventory_items\s+ALTER COLUMN quantity DROP NOT NULL/);
    expect(sql).toMatch(/ALTER COLUMN quantity DROP DEFAULT/);
    expect(sql).not.toMatch(/UPDATE inventory_items/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
  });
});
