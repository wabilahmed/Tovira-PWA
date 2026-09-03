import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [INV-DATA] Inventory isolation contract. RLS + composite FKs are the real DB-level net
 * (validated on boot); here we prove the contract the API must uphold: one tenant never
 * reads another's item, and an id-taking route gives a byte-identical 404 for a foreign or
 * unknown id — no existence oracle.
 */
describe('[INV-DATA] inventory tenant isolation', () => {
  let server: Server | undefined;
  afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); });

  async function boot(): Promise<{ deps: TestDeps; base: string }> {
    const deps = buildInMemoryDeps();
    server = createApiServer(deps);
    await new Promise<void>((r) => server!.listen(0, r));
    return { deps, base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}` };
  }
  async function signup(base: string, email: string): Promise<string> {
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
    return ((await res.json()) as { token: string }).token;
  }

  it("B gets an identical 404 for A's item id and for a random UUID (no existence oracle)", async () => {
    const { deps, base } = await boot();
    const tokenA = await signup(base, 'a@example.com');
    const tokenB = await signup(base, 'b@example.com');
    const userIdA = (await deps.auth.authenticate(tokenA))!.userId;
    const item = await deps.inventory.create(userIdA, { title: 'Marina 2-bed', description: 'sea view', quantity: 1, embedding: null });

    const foreign = await fetch(`${base}/inventory/${item.id}`, { headers: { authorization: `Bearer ${tokenB}` } });
    const unknown = await fetch(`${base}/inventory/${randomUUID()}`, { headers: { authorization: `Bearer ${tokenB}` } });
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await foreign.text()).toBe(await unknown.text()); // byte-identical body

    // The owner reads it fine.
    const owner = await fetch(`${base}/inventory/${item.id}`, { headers: { authorization: `Bearer ${tokenA}` } });
    expect(owner.status).toBe(200);
    expect((await owner.json() as { id: string; title: string }).title).toBe('Marina 2-bed');
  });

  it('list is scoped to the caller (A never sees B\'s items) and never leaks user_id/embedding', async () => {
    const { deps, base } = await boot();
    const tokenA = await signup(base, 'a2@example.com');
    const tokenB = await signup(base, 'b2@example.com');
    const userIdA = (await deps.auth.authenticate(tokenA))!.userId;
    const userIdB = (await deps.auth.authenticate(tokenB))!.userId;
    await deps.inventory.create(userIdA, { title: 'A item', description: 'x', quantity: 2, embedding: [0.1, 0.2] });
    await deps.inventory.create(userIdB, { title: 'B item', description: 'y', quantity: 1, embedding: null });

    const res = await fetch(`${base}/inventory`, { headers: { authorization: `Bearer ${tokenA}` } });
    const body = await res.json() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.title).toBe('A item');
    expect(body.items[0]).not.toHaveProperty('userId');
    expect(body.items[0]).not.toHaveProperty('embedded');
  });

  it('requires authentication', async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/inventory`)).status).toBe(401);
  });
});
