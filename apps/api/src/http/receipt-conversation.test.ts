import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/** [P36-5] POST /receipts/conversation — a page of the rep's own chat; another rep's note is a 404. */
let server: Server;
let base: string;
let deps: TestDeps;
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const post = (token: string, body: unknown) => fetch(`${base}/receipts/conversation`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

describe('[P36-5] POST /receipts/conversation', () => {
  it('returns the latest page, then the page before it', async () => {
    const { token, userId } = await signup('conv@example.com');
    const c = await deps.clients.create(userId, 'Sara');
    const messages = Array.from({ length: 5 }, (_, i) => ({ sender: i % 2 ? 'Wabil' : 'Sara', sentAt: `2026-03-0${i + 1}T09:00`, body: `m${i}`, media: false, role: i % 2 ? 'rep' : 'client' }));
    const n = await deps.notes.create(userId, { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted', messages } as never);
    const last = (await (await post(token, { noteId: n.id, limit: 2 })).json()) as { source: { bubbles: Array<{ text: string }>; hasMore: boolean }; from: number };
    expect(last.source.bubbles.map((b) => b.text)).toEqual(['m3', 'm4']);
    expect(last.source.hasMore).toBe(true);
    const older = (await (await post(token, { noteId: n.id, before: last.from, limit: 2 })).json()) as { source: { bubbles: Array<{ text: string }> } };
    expect(older.source.bubbles.map((b) => b.text)).toEqual(['m1', 'm2']);
  });

  it('another rep\'s note → 404; no session → 401', async () => {
    const a = await signup('conv-a@example.com');
    const b = await signup('conv-b@example.com');
    const c = await deps.clients.create(a.userId, 'Sara');
    const n = await deps.notes.create(a.userId, { clientId: c.id, source: 'paste', rawText: 'secret', audioKey: null, status: 'extracted' } as never);
    expect((await post(b.token, { noteId: n.id })).status).toBe(404);
    expect((await fetch(`${base}/receipts/conversation`, { method: 'POST', body: '{}' })).status).toBe(401);
  });
});
