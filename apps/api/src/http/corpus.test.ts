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

describe('[P4-10] corpus stats', () => {
  it('requires auth', async () => {
    expect((await fetch(`${base}/corpus-stats`)).status).toBe(401);
  });

  it('returns zero for a fresh account', async () => {
    const token = await signup('fresh-corpus@example.com');
    const body = (await (await fetch(`${base}/corpus-stats`, { headers: { authorization: `Bearer ${token}` } })).json()) as { months: number; moments: number };
    expect(body).toEqual({ months: 0, moments: 0 });
  });

  it('counts captured notes as moments', async () => {
    const token = await signup('corpus@example.com');
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const cid = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;
    await fetch(`${base}/clients/${cid}/notes/paste`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'a note' }) });
    const body = (await (await fetch(`${base}/corpus-stats`, { headers: { authorization: `Bearer ${token}` } })).json()) as { moments: number };
    expect(body.moments).toBe(1);
  });
});
