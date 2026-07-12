import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function client(t: string, name: string): Promise<string> {
  return ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(t), body: JSON.stringify({ name }) })).json()) as { id: string }).id;
}
async function paste(t: string, clientId: string, text: string): Promise<void> {
  await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: auth(t), body: JSON.stringify({ text }) });
}

describe('[P5-3] onboarding status', () => {
  it('nudges toward the first value moment as the rep seeds data', async () => {
    const token = await signup('onboard@example.com');
    let s = (await (await fetch(`${base}/onboarding/status`, { headers: auth(token) })).json()) as { hasClient: boolean; briefReachable: boolean; nextStep: string };
    expect(s.hasClient).toBe(false);
    expect(s.nextStep).toMatch(/first client/i);
    const c = await client(token, 'Meridian');
    await paste(token, c, 'some real history to work with');
    s = (await (await fetch(`${base}/onboarding/status`, { headers: auth(token) })).json()) as { hasClient: boolean; briefReachable: boolean; nextStep: string };
    expect(s.briefReachable).toBe(true);
    expect(s.nextStep).toMatch(/brief/i);
  });
});

describe('[P5-4] data trust & control', () => {
  it('exports the rep\'s data', async () => {
    const token = await signup('export@example.com');
    const c = await client(token, 'Export Corp');
    await paste(token, c, 'exported note content');
    const data = (await (await fetch(`${base}/account/export`, { headers: auth(token) })).json()) as { clients: unknown[]; notes: Array<{ rawText: string }> };
    expect(data.clients).toHaveLength(1);
    expect(data.notes.some((n) => n.rawText.includes('exported note'))).toBe(true);
  });

  // NEGATIVE: after delete, the data does not reappear.
  it('deletes the account and its data so nothing reappears', async () => {
    const token = await signup('delete@example.com');
    const c = await client(token, 'Delete Corp');
    await paste(token, c, 'secret note');
    expect((await fetch(`${base}/account`, { method: 'DELETE', headers: auth(token) })).status).toBe(200);
    // The account is gone (protected identity route 401) and its clients are purged.
    expect((await fetch(`${base}/me`, { headers: auth(token) })).status).toBe(401);
    const list = (await (await fetch(`${base}/clients`, { headers: auth(token) })).json()) as { clients: unknown[] };
    expect(list.clients).toEqual([]);
  });

  it('requires auth for export and delete', async () => {
    expect((await fetch(`${base}/account/export`)).status).toBe(401);
    expect((await fetch(`${base}/account`, { method: 'DELETE' })).status).toBe(401);
  });
});
