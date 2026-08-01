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

describe('[P3-8] Monday digest', () => {
  it('requires auth', async () => {
    expect((await fetch(`${base}/monday-digest`)).status).toBe(401);
  });

  // Viewable in-app regardless of push; a fresh account gets an honest light week.
  it('returns a light digest for a fresh account', async () => {
    const token = await signup('monday@example.com');
    const body = (await (await fetch(`${base}/monday-digest`, { headers: { authorization: `Bearer ${token}` } })).json()) as { isLight: boolean; weekOf: string };
    expect(body.isLight).toBe(true);
    expect(body.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
