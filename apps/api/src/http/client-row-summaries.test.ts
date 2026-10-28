import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P36-6] Seen: every Clients row said "ON FILE SINCE OCT 2026" (the same for everyone). A row now tells the rep
 * something: the wants line built from the STORED requirements ("4BR villa · Mirdif · 3.4M"), the last message,
 * the overdue promises — and the client's learned aliases, so the list can be searched by them.
 */
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

describe('[P36-6] GET /clients/row-summaries', () => {
  it('one summary per client: wants line from the stored requirements, last message, overdue promises, aliases', async () => {
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rows@example.com', password: 'password123' }) });
    const { token, user } = (await res.json()) as { token: string; user: { id: string } };
    const c = await deps.clients.create(user.id, 'QA Windowed Buyer 2');
    const bare = await deps.clients.create(user.id, 'New Lead');
    const n = await deps.notes.create(user.id, { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted', messages: [
      { sender: 'Windowed Buyer', sentAt: '2026-05-01T09:00', body: 'looking for a 4BR villa in Mirdif, budget around 3M', media: false, role: 'client' },
      { sender: 'Wabil', sentAt: '2026-05-16T12:00', body: 'noted', media: false, role: 'rep' },
    ] } as never);
    await deps.requirements.saveForNote(user.id, n.id, c.id, [
      { text: '4BR villa in Mirdif', requirementRaw: 'looking for a 4BR villa in Mirdif, budget around 3M', statedOn: '2026-05-01', confidence: 'high', embedding: null },
      { text: 'Updated budget of 3.4M', requirementRaw: 'our budget is now 3.4M', statedOn: '2026-05-16', confidence: 'high', embedding: null },
    ]);
    await deps.facts.saveExtraction(user.id, { noteId: n.id, clientId: c.id, captureAt: '2026-05-16', promises: [
      { text: 'send the ID photos', owner: 'client', due_date: new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10), // overdue, not stale (≤ 90 days)
      due_raw: null, confidence: 'high', source_span: 'I will send the ID photos', source_message_at: '2026-05-16T12:00' },
    ] });
    await deps.aliases!.add(user.id, c.id, 'Abu Khalid');
    const body = (await (await fetch(`${base}/clients/row-summaries`, { headers: { authorization: `Bearer ${token}` } })).json()) as { rows: Record<string, { listLine: string | null; lastMessageAt: string | null; overduePromises: number; aliases: string[] }> };
    expect(body.rows[c.id]).toEqual({ listLine: '4BR Villa · Mirdif · AED 3.4M', lastMessageAt: '2026-05-16T12:00', overduePromises: 1, aliases: ['Abu Khalid'] });
    expect(body.rows[bare.id]).toEqual({ listLine: null, lastMessageAt: null, overduePromises: 0, aliases: [] });
  });

  it('needs a session', async () => {
    expect((await fetch(`${base}/clients/row-summaries`)).status).toBe(401);
  });
});
