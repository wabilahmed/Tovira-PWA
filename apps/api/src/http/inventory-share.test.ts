import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';

/** [INV-SHARE] sharing, the bought→decrement→sold_out lifecycle, and the duplicate warning. */
describe('[INV-SHARE] sharing and lifecycle', () => {
  let server: Server | undefined;
  afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); });

  const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  async function boot() {
    server = createApiServer(buildInMemoryDeps());
    await new Promise<void>((r) => server!.listen(0, r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const token = ((await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `s${randomUUID()}@x.com`, password: 'password123' }) })).json()) as { token: string }).token;
    const client = await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Meridian' }) })).json() as { id: string };
    const item = async (quantity: number) => (await (await fetch(`${base}/inventory`, { method: 'POST', headers: H(token), body: JSON.stringify({ title: 't', description: 'd', quantity }) })).json() as { id: string }).id;
    const share = (itemId: string, clientId = client.id) => fetch(`${base}/inventory/${itemId}/shares`, { method: 'POST', headers: H(token), body: JSON.stringify({ clientId }) });
    const setOutcome = (shareId: string, body: unknown) => fetch(`${base}/inventory/shares/${shareId}`, { method: 'PATCH', headers: H(token), body: JSON.stringify(body) });
    const getItem = async (itemId: string) => await (await fetch(`${base}/inventory/${itemId}`, { headers: H(token) })).json() as { quantity: number; status: string; disabledReason: string | null };
    return { base, token, client, item, share, setOutcome, getItem };
  }

  it('sharing never decrements quantity (only logs intent, pending)', async () => {
    const t = await boot();
    const itemId = await t.item(5);
    const res = await t.share(itemId);
    expect(res.status).toBe(201);
    expect((await t.getItem(itemId)).quantity).toBe(5); // unchanged
    expect((await res.json() as { share: { outcome: string } }).share.outcome).toBe('pending');
  });

  it('a bought outcome decrements by the entered amount; reaching 0 disables as sold_out but stays visible', async () => {
    const t = await boot();
    const itemId = await t.item(3);
    const share = (await (await t.share(itemId)).json() as { share: { id: string } }).share;
    await t.setOutcome(share.id, { outcome: 'bought', quantityBought: 3 });
    const after = await t.getItem(itemId);
    expect(after.quantity).toBe(0);
    expect(after.status).toBe('disabled');
    expect(after.disabledReason).toBe('sold_out');
    // still visible under the disabled filter (never deleted)
    const disabled = await (await fetch(`${t.base}/inventory?status=disabled`, { headers: H(t.token) })).json() as { items: unknown[] };
    expect(disabled.items).toHaveLength(1);
  });

  it('a broker with quantity 50 sharing to 3 clients sees NO duplicate warning', async () => {
    const t = await boot();
    const itemId = await t.item(50);
    for (let i = 0; i < 3; i++) {
      const c = await (await fetch(`${t.base}/clients`, { method: 'POST', headers: H(t.token), body: JSON.stringify({ name: `c${i}` }) })).json() as { id: string };
      const body = await (await t.share(itemId, c.id)).json() as { warning: unknown };
      expect(body.warning).toBeNull();
    }
  });

  it('quantity 1 shared twice DOES warn, naming the prior share', async () => {
    const t = await boot();
    const itemId = await t.item(1);
    expect((await (await t.share(itemId)).json() as { warning: unknown }).warning).toBeNull(); // first share, no warning
    const second = await (await t.share(itemId)).json() as { warning: Array<{ clientId: string }> | null };
    expect(second.warning).not.toBeNull();
    expect(second.warning![0]!.clientId).toBe(t.client.id); // the prior pending share
  });

  it('a disabled item cannot be shared — 409, and the block states why', async () => {
    const t = await boot();
    const itemId = await t.item(1);
    await fetch(`${t.base}/inventory/${itemId}`, { method: 'PATCH', headers: H(t.token), body: JSON.stringify({ quantity: 0 }) }); // disable
    const res = await t.share(itemId);
    expect(res.status).toBe(409);
    expect((await res.json() as { message: string }).message).toMatch(/out of stock/i);
  });

  it('sharing to a foreign/unknown client is a 404 (no share created)', async () => {
    const t = await boot();
    const itemId = await t.item(1);
    expect((await t.share(itemId, randomUUID())).status).toBe(404);
    expect((await (await fetch(`${t.base}/inventory/${itemId}/shares`, { headers: H(t.token) })).json() as { shares: unknown[] }).shares).toHaveLength(0);
  });

  it('declined/no_response never touch quantity; share history is preserved', async () => {
    const t = await boot();
    const itemId = await t.item(4);
    const share = (await (await t.share(itemId)).json() as { share: { id: string } }).share;
    await t.setOutcome(share.id, { outcome: 'declined' });
    expect((await t.getItem(itemId)).quantity).toBe(4); // untouched
    const hist = await (await fetch(`${t.base}/inventory/${itemId}/shares`, { headers: H(t.token) })).json() as { shares: Array<{ outcome: string }> };
    expect(hist.shares).toHaveLength(1);
    expect(hist.shares[0]!.outcome).toBe('declined');
  });
});
