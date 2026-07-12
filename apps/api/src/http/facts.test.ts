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

async function seedPromise(userId: string): Promise<string> {
  await deps.facts.saveExtraction(userId, { noteId: 'note-x', clientId: 'client-x', promises: [lowConfidence] });
  const [p] = await deps.facts.listPromisesByUser(userId);
  return p!.id;
}

describe('[P2-3] confirm & correct', () => {
  it('edits a promise and records a before/after correction (training data)', async () => {
    const { token, userId } = await signup('edit@example.com');
    const id = await seedPromise(userId);
    const res = await fetch(`${base}/promises/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'send the FINAL plan' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }).text).toBe('send the FINAL plan');

    const corrections = await deps.corrections.listByUser(userId);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]!.field).toBe('text');
    expect(corrections[0]!.before).toBe('send plan');
    expect(corrections[0]!.after).toBe('send the FINAL plan');
  });

  it('does not double-count a correction when nothing changed', async () => {
    const { token, userId } = await signup('nochange@example.com');
    const id = await seedPromise(userId);
    await fetch(`${base}/promises/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'send plan' }), // same value
    });
    expect(await deps.corrections.listByUser(userId)).toEqual([]);
  });

  // NEGATIVE: rejecting an item removes it so it never surfaces again.
  it('rejects (deletes) a promise so it no longer appears', async () => {
    const { token, userId } = await signup('reject@example.com');
    const id = await seedPromise(userId);
    const del = await fetch(`${base}/promises/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);
    const pending = (await (await fetch(`${base}/confirmations`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { promises: unknown[] };
    expect(pending.promises).toEqual([]);
  });

  it('does not let a rep edit or delete another rep\'s promise (404)', async () => {
    const a = await signup('a-edit@example.com');
    const b = await signup('b-edit@example.com');
    const id = await seedPromise(a.userId);
    const patch = await fetch(`${base}/promises/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${b.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hacked' }),
    });
    expect(patch.status).toBe(404);
    const del = await fetch(`${base}/promises/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${b.token}` } });
    expect(del.status).toBe(404);
  });
});
