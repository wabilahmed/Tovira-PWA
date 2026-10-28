import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P47 · found by the self-discovering erasure guard] Find read requirements unrestricted: a requirement the restricted
 * person stated still gave the client's wants line ("4BR Villa · <their area>") on Find's lists and their area in the
 * "Clients wanting…" options. Find now reads requirements through the restricted view.
 */
let server: Server; let base: string; let deps: TestDeps;
const DAY = 86_400_000; const MARK = 'SALTMARSHOPAL';
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[P47] Find never shows a restricted person\'s wants', () => {
  it('NEGATIVE: the wants line on Find\'s lists and the "Clients wanting…" options drop their requirement', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fr1@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
    const u = b.user.id; const H = { authorization: `Bearer ${b.token}` };
    const c = await deps.clients.create(u, 'Marina Estates');
    const said = `looking for a 4BR villa in ${MARK} Gardens`;
    const note = await deps.notes.create(u, { clientId: c.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', messages: [{ sentAt: '2026-01-01T10:00', sender: 'Khalid', body: said, media: false, role: 'client' }] } as never);
    await deps.requirements.saveForNote(u, note.id, c.id, [{ text: `4BR villa in ${MARK} Gardens`, requirementRaw: said, statedOn: '2026-01-01', confidence: 'high', embedding: null }]);
    await deps.clients.setLastTouched(u, c.id, Date.now() - 45 * DAY);
    const read = async (p: string) => (await fetch(`${base}${p}`, { headers: H })).text();
    expect(await read('/find/wanting/options')).toContain(MARK); // the fixture really carries it
    expect(await read('/find/cold-clients')).toContain(MARK);
    await deps.erasureRequests.create(u, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    for (const p of ['/find/wanting/options', '/find/cold-clients', '/find/open-requirements', '/find/active-clients']) expect(await read(p), p).not.toContain(MARK);
  });
});
