import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P47 · found by the self-discovering erasure guard] Deals at risk (and Find's "deals at risk") counted the restricted
 * person's missed promise and quoted their message as its receipt: the hero service read promises unrestricted. It now
 * reads promises and meetings through the restricted views.
 */
let server: Server; let base: string; let deps: TestDeps;
const DAY = 86_400_000; const MARK = 'EMBERLARKSPUR';
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[P47] Deals at risk never quotes a restricted person', () => {
  it('NEGATIVE: /hero/risk and /find/deals-at-risk drop their missed promise and its receipt', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rk1@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
    const u = b.user.id; const H = { authorization: `Bearer ${b.token}` };
    const said = `${MARK} will send the passport copy by Sunday`;
    const c = await deps.clients.create(u, 'Marina Estates');
    const note = await deps.notes.create(u, { clientId: c.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', messages: [{ sentAt: '2026-01-02T10:00', sender: 'Khalid', body: said, media: false, role: 'client' }] } as never);
    await deps.facts.saveExtraction(u, { noteId: note.id, clientId: c.id, promises: [{ text: 'Send the passport copy', owner: 'client', due_date: new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10), due_raw: 'by Sunday', confidence: 'high', source_span: said, source_message_at: '2026-01-02T10:00' }] });
    // a book big enough to unlock the insights
    for (let i = 0; i < 5; i++) { const f = await deps.clients.create(u, `Filler ${i}`); for (let n = 0; n < 4; n++) await deps.notes.create(u, { clientId: f.id, source: 'paste', rawText: 'coffee', audioKey: null, status: 'extracted' } as never); }
    await deps.clients.setLastTouched(u, c.id, Date.now() - 45 * DAY);
    const read = async (p: string) => (await fetch(`${base}${p}`, { headers: H })).text();
    expect(await read('/hero/risk')).toContain(MARK); // the fixture really carries it
    await deps.erasureRequests.create(u, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    for (const p of ['/hero/risk', '/find/deals-at-risk']) expect(await read(p), p).not.toContain(MARK);
  });
});
