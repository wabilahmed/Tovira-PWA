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
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

const lowConfidence = { text: 'send plan', owner: 'rep' as const, due_date: null, due_raw: 'end of week', confidence: 'low' as const };

describe('[P1-7] confirmation queue', () => {
  it('surfaces uncertain promises for confirmation and confirms them', async () => {
    const { token, userId } = await signup('confirm@example.com');
    await deps.facts.saveExtraction(userId, { noteId: 'n1', clientId: 'c1', promises: [lowConfidence] });

    const listRes = await fetch(`${base}/confirmations`, { headers: { authorization: `Bearer ${token}` } });
    expect(listRes.status).toBe(200);
    const pending = (await listRes.json()) as { promises: Array<{ id: string }> };
    expect(pending.promises).toHaveLength(1);

    const id = pending.promises[0]!.id;
    const confirmRes = await fetch(`${base}/promises/${id}/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(confirmRes.status).toBe(200);

    // Once confirmed it leaves the queue.
    const after = (await (await fetch(`${base}/confirmations`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { promises: unknown[] };
    expect(after.promises).toEqual([]);
  });

  it('rejects the confirmation queue without auth (401)', async () => {
    expect((await fetch(`${base}/confirmations`)).status).toBe(401);
  });

  it('returns 404 confirming an unknown promise', async () => {
    const { token } = await signup('unknown-confirm@example.com');
    const res = await fetch(`${base}/promises/00000000-0000-4000-8000-000000000000/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('does not surface another rep\'s pending confirmations', async () => {
    const a = await signup('a-confirm@example.com');
    const b = await signup('b-confirm@example.com');
    await deps.facts.saveExtraction(a.userId, { noteId: 'n2', clientId: 'c2', promises: [lowConfidence] });
    const bList = (await (await fetch(`${base}/confirmations`, {
      headers: { authorization: `Bearer ${b.token}` },
    })).json()) as { promises: unknown[] };
    expect(bList.promises).toEqual([]);
  });
});
