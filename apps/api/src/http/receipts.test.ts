import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/** [P35-3] POST /receipts/sources (one request per list) and /receipts/thread (tap) — the rep's own notes only. */
let server: Server; let base: string; let deps: TestDeps;
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const post = (token: string, path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const msg = (role: 'rep' | 'client', sender: string, sentAt: string, body: string) => ({ sender, sentAt, body, media: false, role });

describe('[P35-3] receipt source endpoints', () => {
  it('resolves a batch of refs to bubbles (source flagged, sides from the import), and returns the full thread on request', async () => {
    const { token, userId } = await signup('receipts@example.com');
    const c = await deps.clients.create(userId, 'Sara Khan');
    const msgs = Array.from({ length: 10 }, (_, i) => msg(i % 2 ? 'rep' : 'client', i % 2 ? 'Wabil' : 'Sara Khan', `2026-03-02T10:${String(10 + i).padStart(2, '0')}`, `message ${i}`));
    const n = await deps.notes.create(userId, { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted', messages: msgs });
    const res = await post(token, '/receipts/sources', { refs: [{ noteId: n.id, span: 'message 5', at: '2026-03-02T10:15' }, { quote: 'old fact', sender: 'Sara Khan' }] });
    expect(res.status).toBe(200);
    const { sources } = (await res.json()) as { sources: Array<{ bubbles: Array<{ text: string; side: string; source: boolean }>; hasMore: boolean }> };
    expect(sources[0]!.bubbles.find((b) => b.source)).toMatchObject({ text: 'message 5', side: 'rep' });
    expect(sources[0]!.bubbles).toHaveLength(7);
    expect(sources[0]!.hasMore).toBe(true);
    expect(sources[1]!.bubbles).toEqual([expect.objectContaining({ text: 'old fact', side: 'other', source: true })]);
    const full = (await (await post(token, '/receipts/thread', { ref: { noteId: n.id, span: 'message 5' }, full: true })).json()) as { source: { bubbles: unknown[] } };
    expect(full.source.bubbles).toHaveLength(10);
  });

  it('NEGATIVE: another rep\'s note never resolves (a quote bubble at most, never their messages); no session → 401', async () => {
    const a = await signup('receipts-a@example.com');
    const b = await signup('receipts-b@example.com');
    const c = await deps.clients.create(a.userId, 'Private Client');
    const n = await deps.notes.create(a.userId, { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted', messages: [msg('client', 'Private Client', '2026-03-02T10:00', 'secret message')] });
    const { sources } = (await (await post(b.token, '/receipts/sources', { refs: [{ noteId: n.id }] })).json()) as { sources: Array<{ bubbles: Array<{ text: string }> }> };
    expect(JSON.stringify(sources)).not.toContain('secret message');
    expect((await fetch(`${base}/receipts/sources`, { method: 'POST', body: '{}' })).status).toBe(401);
  });
});
