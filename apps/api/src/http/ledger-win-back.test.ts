import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// [P47-2] Through the API: Today reports the going-quiet cards it showed; the Ledger lists the clients who wrote back
// within a week as "Clients Tovira helped you win back" (no AED), restricted clients withheld.
let server: Server;
let base: string;
let deps: TestDeps;
const DAY = 86_400_000;
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function quietClient(email: string, name = 'Sara Khan') {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  const H = { authorization: `Bearer ${b.token}`, 'content-type': 'application/json' };
  const c = await deps.clients.create(b.user.id, name);
  await deps.clients.setLastTouched(b.user.id, c.id, Date.now() - 40 * DAY);
  return { H, userId: b.user.id, clientId: c.id };
}
const winBacks = async (H: Record<string, string>) => ((await (await fetch(`${base}/ledger`, { headers: H })).json()) as { winBacks: Array<{ clientName: string; silentDays: number; receipt: { quote: string }; dealValueAed?: unknown }> }).winBacks;
async function reply(userId: string, clientId: string, inMs: number) {
  const at = new Date(Date.now() + inMs).toISOString().slice(0, 16);
  await deps.notes.create(userId, { clientId, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', messages: [{ sentAt: at, sender: 'Sara', body: 'Back from travel, can we talk?', media: false, role: 'client' }] });
}

describe('[P47-2] win-backs through the API', () => {
  it('Today reports the card shown; the client writes back → listed, with no AED', async () => {
    const r = await quietClient('wb1@example.com');
    expect((await fetch(`${base}/today/cold-shown`, { method: 'POST', headers: r.H, body: JSON.stringify({ clientIds: [r.clientId] }) })).status).toBe(200);
    await reply(r.userId, r.clientId, 2 * DAY);
    const list = await winBacks(r.H);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ clientName: 'Sara Khan', silentDays: 40, receipt: { quote: 'Back from travel, can we talk?' } });
    expect(list[0]).not.toHaveProperty('dealValueAed');
  });

  it('NEGATIVE: no card reported shown → nothing, even when the client writes', async () => {
    const r = await quietClient('wb2@example.com');
    await reply(r.userId, r.clientId, DAY);
    expect(await winBacks(r.H)).toEqual([]);
  });

  it('NEGATIVE: a restricted client is withheld', async () => {
    const r = await quietClient('wb3@example.com', 'Khalid Restricted');
    await fetch(`${base}/today/cold-shown`, { method: 'POST', headers: r.H, body: JSON.stringify({ clientIds: [r.clientId] }) });
    await reply(r.userId, r.clientId, DAY);
    expect(await winBacks(r.H)).toHaveLength(1);
    await deps.erasureRequests.create(r.userId, { requesterNames: ['Khalid Restricted'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    expect(await winBacks(r.H)).toEqual([]);
  });

  it('NEGATIVE: the report needs a session (401) and a list of ids (400)', async () => {
    const r = await quietClient('wb4@example.com');
    expect((await fetch(`${base}/today/cold-shown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientIds: [] }) })).status).toBe(401);
    expect((await fetch(`${base}/today/cold-shown`, { method: 'POST', headers: r.H, body: JSON.stringify({ clientIds: 'x' }) })).status).toBe(400);
  });
});
