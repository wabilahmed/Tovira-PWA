import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { promiseDedupeKey } from '../services/facts/promise-identity.js';

// [P47 · found by the self-discovering erasure guard] "Looks like they sent it" read promises unrestricted, so a
// suggestion on the restricted person's promise quoted their delivery message. It now reads through the restriction.
let server: Server; let base: string; let deps: TestDeps;
const DAY = 86_400_000; const MARK = 'COPPERFINCH';
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[P47] kept suggestions honour the restriction', () => {
  it('NEGATIVE: a suggestion on their promise, quoting their delivery message, leaves /promises/kept-suggestions', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ks1@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
    const u = b.user.id; const H = { authorization: `Bearer ${b.token}` };
    const c = await deps.clients.create(u, 'Marina Estates');
    const said = `${MARK} will send the passport copy`;
    const note = await deps.notes.create(u, { clientId: c.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', messages: [
      { sentAt: '2026-01-02T10:00', sender: 'Khalid', body: said, media: false, role: 'client' },
      { sentAt: '2026-01-03T09:00', sender: 'Khalid', body: `${MARK} here is the passport copy`, media: false, role: 'client' },
    ] } as never);
    await deps.facts.saveExtraction(u, { noteId: note.id, clientId: c.id, promises: [{ text: 'Send the passport copy', owner: 'client', due_date: null, due_raw: null, confidence: 'high', source_span: said, source_message_at: '2026-01-02T10:00' }] });
    await deps.keptSuggestionRepo.createIfAbsent(u, { clientId: c.id, noteId: note.id, promiseKey: promiseDedupeKey('client', 'Send the passport copy'), promiseOwner: 'client', promiseText: 'Send the passport copy', promiseSpan: said, promiseAt: '2026-01-02T10:00', deliveryAt: '2026-01-03T09:00', deliveryBody: `${MARK} here is the passport copy` });
    const read = async () => (await fetch(`${base}/promises/kept-suggestions`, { headers: H })).text();
    expect(await read()).toContain(MARK);
    await deps.erasureRequests.create(u, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    expect(await read()).not.toContain(MARK);
  });
});
