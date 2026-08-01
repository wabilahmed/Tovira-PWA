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
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ledger = async (t: string) => (await (await fetch(`${base}/ledger`, { headers: auth(t) })).json()) as { totalTouched: number; byType: Record<string, number>; aed: number | null };

async function createClient(token: string, name: string): Promise<string> {
  return ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name }) })).json()) as { id: string }).id;
}

describe('[P4-11] Recovered Value Ledger', () => {
  it('requires auth', async () => {
    expect((await fetch(`${base}/ledger`)).status).toBe(401);
  });

  it('records a promise kept on time, and removes it when the promise is deleted', async () => {
    const { token, userId } = await signup('kept@example.com');
    const cid = await createClient(token, 'Acme');
    await deps.facts.saveExtraction(userId, { noteId: 'n1', clientId: cid, promises: [{ text: 'send quote', owner: 'rep', due_date: iso(Date.now() + 10 * 86400000), due_raw: null, confidence: 'high' }] });
    const pid = ((await (await fetch(`${base}/promises`, { headers: auth(token) })).json()) as { promises: Array<{ id: string }> }).promises[0]!.id;

    await fetch(`${base}/promises/${pid}/done`, { method: 'POST', headers: auth(token) });
    expect((await ledger(token)).byType.promise_kept).toBe(1);

    await fetch(`${base}/promises/${pid}`, { method: 'DELETE', headers: auth(token) });
    expect((await ledger(token)).totalTouched).toBe(0); // no orphaned value claim
  });

  // HONESTY: no AED until the rep enters a deal value; then it reflects it.
  it('shows AED only after a deal value is entered', async () => {
    const { token, userId } = await signup('aed@example.com');
    const cid = await createClient(token, 'Beta');
    await deps.facts.saveExtraction(userId, { noteId: 'n', clientId: cid, promises: [{ text: 'x', owner: 'rep', due_date: iso(Date.now() + 5 * 86400000), due_raw: null, confidence: 'high' }] });
    const pid = ((await (await fetch(`${base}/promises`, { headers: auth(token) })).json()) as { promises: Array<{ id: string }> }).promises[0]!.id;
    await fetch(`${base}/promises/${pid}/done`, { method: 'POST', headers: auth(token) });

    expect((await ledger(token)).aed).toBeNull(); // never estimated
    await fetch(`${base}/clients/${cid}/deal-value`, { method: 'POST', headers: auth(token), body: JSON.stringify({ aed: 500000 }) });
    expect((await ledger(token)).aed).toBe(500000);
  });

  it('records a thread reopened when a note is captured for a flagged client', async () => {
    const { token, userId } = await signup('reopen@example.com');
    const cid = await createClient(token, 'Quiet Co');
    // Simulate a scan having flagged the client as going cold.
    await deps.notifications.createIfAbsent(userId, { type: 'going_cold', dedupeKey: `cold:${cid}`, clientId: cid, title: 'cold', body: 'quiet' });
    await fetch(`${base}/clients/${cid}/notes/paste`, { method: 'POST', headers: auth(token), body: JSON.stringify({ text: 'reaching back out' }) });
    expect((await ledger(token)).byType.thread_reopened).toBe(1);
  });

  it('records a brief viewed before a logged meeting', async () => {
    const { token, userId } = await signup('brief-ledger@example.com');
    const cid = await createClient(token, 'Gamma');
    // A logged upcoming meeting + a fact so the brief is non-empty.
    await fetch(`${base}/clients/${cid}/meetings`, { method: 'POST', headers: auth(token), body: JSON.stringify({ datetime: new Date(Date.now() + 2 * 86400000).toISOString(), datetimeRaw: 'in 2 days', title: 'Review' }) });
    await deps.facts.saveExtraction(userId, { noteId: 'n', clientId: cid, promises: [{ text: 'prep deck', owner: 'rep', due_date: null, due_raw: 'soon', confidence: 'high' }] });
    await fetch(`${base}/clients/${cid}/brief`, { headers: auth(token) });
    expect((await ledger(token)).byType.brief_before_meeting).toBe(1);
  });

  it('does not leak ledger entries across tenants', async () => {
    const a = await signup('a-ledger@example.com');
    const cid = await createClient(a.token, 'A Co');
    await deps.facts.saveExtraction(a.userId, { noteId: 'n', clientId: cid, promises: [{ text: 'x', owner: 'rep', due_date: iso(Date.now() + 3 * 86400000), due_raw: null, confidence: 'high' }] });
    const pid = ((await (await fetch(`${base}/promises`, { headers: auth(a.token) })).json()) as { promises: Array<{ id: string }> }).promises[0]!.id;
    await fetch(`${base}/promises/${pid}/done`, { method: 'POST', headers: auth(a.token) });

    const b = await signup('b-ledger@example.com');
    expect((await ledger(b.token)).totalTouched).toBe(0);
  });
});
