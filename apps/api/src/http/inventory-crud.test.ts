import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';

/** [INV-CRUD] create / edit / list, and the arithmetic quantity↔status coupling. */
describe('[INV-CRUD] inventory CRUD', () => {
  let server: Server | undefined;
  afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); });

  async function boot(): Promise<{ base: string; token: string }> {
    server = createApiServer(buildInMemoryDeps());
    await new Promise<void>((r) => server!.listen(0, r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `c${randomUUID()}@x.com`, password: 'password123' }) });
    return { base, token: ((await res.json()) as { token: string }).token };
  }
  const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  it('creates an item (quantity defaults to 1, status active) and lists it', async () => {
    const { base, token } = await boot();
    const res = await fetch(`${base}/inventory`, { method: 'POST', headers: H(token), body: JSON.stringify({ title: 'Marina 2-bed', description: 'sea view, 1200 sqft' }) });
    expect(res.status).toBe(201);
    const item = await res.json() as { id: string; quantity: number; status: string; title: string };
    expect(item.quantity).toBe(1);
    expect(item.status).toBe('active');
    const list = await (await fetch(`${base}/inventory`, { headers: H(token) })).json() as { items: unknown[] };
    expect(list.items).toHaveLength(1);
  });

  it('rejects a blank title, blank description, or a negative quantity', async () => {
    const { base, token } = await boot();
    const bad = async (body: unknown) => (await fetch(`${base}/inventory`, { method: 'POST', headers: H(token), body: JSON.stringify(body) })).status;
    expect(await bad({ title: '  ', description: 'x' })).toBe(400);
    expect(await bad({ title: 't', description: '' })).toBe(400);
    expect(await bad({ title: 't', description: 'x', quantity: -1 })).toBe(400);
    expect(await bad({ title: 't', description: 'x', quantity: 1.5 })).toBe(400);
  });

  it('edits fields; a foreign/unknown id is a 404', async () => {
    const { base, token } = await boot();
    const item = await (await fetch(`${base}/inventory`, { method: 'POST', headers: H(token), body: JSON.stringify({ title: 't', description: 'd', quantity: 5 }) })).json() as { id: string };
    const edited = await fetch(`${base}/inventory/${item.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ title: 'renamed', quantity: 9 }) });
    expect(edited.status).toBe(200);
    expect((await edited.json() as { title: string; quantity: number }).title).toBe('renamed');
    expect((await fetch(`${base}/inventory/${randomUUID()}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ title: 'x' }) })).status).toBe(404);
  });

  it('editing quantity to 0 disables (unlisted); editing back above 0 reactivates', async () => {
    const { base, token } = await boot();
    const item = await (await fetch(`${base}/inventory`, { method: 'POST', headers: H(token), body: JSON.stringify({ title: 't', description: 'd', quantity: 2 }) })).json() as { id: string };

    const disabled = await (await fetch(`${base}/inventory/${item.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ quantity: 0 }) })).json() as { status: string; disabledReason: string | null };
    expect(disabled.status).toBe('disabled');
    expect(disabled.disabledReason).toBe('unlisted');

    // it stays visible under the disabled filter
    const dlist = await (await fetch(`${base}/inventory?status=disabled`, { headers: H(token) })).json() as { items: unknown[] };
    expect(dlist.items).toHaveLength(1);

    const reactivated = await (await fetch(`${base}/inventory/${item.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ quantity: 3 }) })).json() as { status: string; disabledReason: string | null; id: string };
    expect(reactivated.status).toBe('active');
    expect(reactivated.disabledReason).toBeNull();
    expect(reactivated.id).toBe(item.id); // same item returning, not a new one
  });
});
