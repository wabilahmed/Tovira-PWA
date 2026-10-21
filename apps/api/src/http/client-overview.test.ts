import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/** [P36-5] GET /clients/:id/overview — the client page's summaries, owner-only. */
let server: Server;
let base: string;
let deps: TestDeps;
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

describe('[P36-5] GET /clients/:id/overview', () => {
  it('returns the summaries for the rep\'s own client', async () => {
    const { token, userId } = await signup('ov@example.com');
    const c = await deps.clients.create(userId, 'QA Windowed Buyer 2');
    const n = await deps.notes.create(userId, { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted', messages: [{ sender: 'Windowed Buyer', sentAt: '2026-05-01T09:00', body: 'looking for a 4BR villa in Mirdif, budget around 3M', media: false, role: 'client' }] } as never);
    await deps.requirements.saveForNote(userId, n.id, c.id, [{ text: '4BR villa in Mirdif', requirementRaw: 'looking for a 4BR villa in Mirdif, budget around 3M', statedOn: '2026-05-01', confidence: 'high', embedding: null }]);
    const res = await fetch(`${base}/clients/${c.id}/overview`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wants: { summary: string }; conversations: Array<{ kind: string; messageCount: number }> };
    expect(body.wants.summary).toBe('4BR Villa · Mirdif · budget ~AED 3M'); // "budget around 3M"
    expect(body.conversations).toEqual([expect.objectContaining({ kind: 'whatsapp', messageCount: 1 })]);
  });

  it('another rep\'s client → 404; no session → 401', async () => {
    const a = await signup('ov-a@example.com');
    const b = await signup('ov-b@example.com');
    const c = await deps.clients.create(a.userId, 'Secret Client');
    expect((await fetch(`${base}/clients/${c.id}/overview`, { headers: { authorization: `Bearer ${b.token}` } })).status).toBe(404);
    expect((await fetch(`${base}/clients/${c.id}/overview`)).status).toBe(401);
  });
});
