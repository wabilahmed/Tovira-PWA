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

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}

describe('[P4b] hero endpoints', () => {
  it('reports a locked/warming state below the threshold and returns no patterns', async () => {
    const { token } = await signup('hero@example.com');
    const status = (await (await fetch(`${base}/hero/status`, { headers: { authorization: `Bearer ${token}` } })).json()) as { unlocked: boolean; message: string };
    expect(status.unlocked).toBe(false);
    expect(status.message).toMatch(/unlock/i);
    const patterns = (await (await fetch(`${base}/hero/patterns`, { headers: { authorization: `Bearer ${token}` } })).json()) as { patterns: unknown[] };
    expect(patterns.patterns).toEqual([]); // gate cannot be bypassed by the client
  });

  it('serves "what should I do today" (always on) — empty with no data', async () => {
    const { token } = await signup('today@example.com');
    const res = await fetch(`${base}/today`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { actions: unknown[] }).actions).toEqual([]);
  });

  it('does not surface another rep\'s actions', async () => {
    const a = await signup('a-hero@example.com');
    const b = await signup('b-hero@example.com');
    const c = await deps.clients.create(a.userId, 'A Corp');
    await deps.facts.saveExtraction(a.userId, { noteId: 'n', clientId: c.id, promises: [{ text: 'x', owner: 'rep', due_date: '2020-01-01', due_raw: '', confidence: 'high' }] });
    const bToday = (await (await fetch(`${base}/today`, { headers: { authorization: `Bearer ${b.token}` } })).json()) as { actions: unknown[] };
    expect(bToday.actions).toEqual([]);
  });

  it('requires auth', async () => {
    expect((await fetch(`${base}/hero/status`)).status).toBe(401);
    expect((await fetch(`${base}/today`)).status).toBe(401);
  });
});
