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
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

describe('[P3-5] in-app cold list + notifications (push-independent)', () => {
  it('serves the going-cold list in-app, with no push involved', async () => {
    const token = await signup('cold-list@example.com');
    await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Corp' }) });
    // days=0 → any client touched before now counts as cold (exercises the list).
    const res = await fetch(`${base}/cold?days=0`, { headers: auth(token) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { clients: unknown[] }).clients.length).toBeGreaterThanOrEqual(1);
    // A recently-touched client is NOT cold at the default threshold.
    const fresh = (await (await fetch(`${base}/cold`, { headers: auth(token) })).json()) as { clients: unknown[] };
    expect(fresh.clients).toEqual([]);
  });

  it('lists in-app notifications and runs the scan', async () => {
    const token = await signup('notif@example.com');
    expect((await fetch(`${base}/scan`, { method: 'POST', headers: auth(token) })).status).toBe(200);
    const res = await fetch(`${base}/notifications`, { headers: auth(token) });
    expect(res.status).toBe(200);
    expect(Array.isArray(((await res.json()) as { notifications: unknown[] }).notifications)).toBe(true);
  });

  it('requires auth for cold list, notifications, and scan', async () => {
    expect((await fetch(`${base}/cold`)).status).toBe(401);
    expect((await fetch(`${base}/notifications`)).status).toBe(401);
    expect((await fetch(`${base}/scan`, { method: 'POST' })).status).toBe(401);
  });
});
