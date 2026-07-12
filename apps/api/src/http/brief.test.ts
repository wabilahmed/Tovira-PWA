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
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return ((await res.json()) as { token: string }).token;
}
async function createClient(token: string, name: string): Promise<string> {
  const res = await fetch(`${base}/clients`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return ((await res.json()) as { id: string }).id;
}

describe('[P2-1] pre-meeting brief endpoint', () => {
  it('returns an honest empty brief for a fresh client', async () => {
    const token = await signup('brief@example.com');
    const clientId = await createClient(token, 'Fresh Corp');
    const res = await fetch(`${base}/clients/${clientId}/brief`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const brief = (await res.json()) as { empty: boolean; clientName: string };
    expect(brief.empty).toBe(true);
    expect(brief.clientName).toBe('Fresh Corp');
  });

  it('rejects an unauthenticated brief request (401)', async () => {
    expect((await fetch(`${base}/clients/whatever/brief`)).status).toBe(401);
  });

  it('does not build a brief for another rep\'s client (404)', async () => {
    const a = await signup('a-brief@example.com');
    const b = await signup('b-brief@example.com');
    const clientA = await createClient(a, 'A Brief Corp');
    const res = await fetch(`${base}/clients/${clientA}/brief`, { headers: { authorization: `Bearer ${b}` } });
    expect(res.status).toBe(404);
  });
});
