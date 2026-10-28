import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P47 · found by the self-discovering erasure guard] Today serves a list computed earlier (no model call, a cost guard).
 * A restriction opened AFTER that list was computed was not applied until the next computation: the going-quiet card
 * still quoted the restricted person's last message. The restriction is now applied when the list is served.
 */
let server: Server; let base: string; let deps: TestDeps;
const DAY = 86_400_000; const MARK = 'TIDEWATERKITE';
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[P47] Today honours a restriction opened after its list was computed', () => {
  it('NEGATIVE: the cached going-quiet card no longer quotes them; the card itself stays (the client is still quiet)', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'tc1@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
    const u = b.user.id; const H = { authorization: `Bearer ${b.token}` };
    const c = await deps.clients.create(u, 'Marina Estates');
    await deps.notes.create(u, { clientId: c.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', messages: [{ sentAt: '2026-01-01T10:00', sender: 'Khalid', body: `${MARK} back from travel`, media: false, role: 'client' }] } as never);
    await deps.clients.setLastTouched(u, c.id, Date.now() - 45 * DAY);
    const first = await (await fetch(`${base}/today`, { headers: H })).text();
    expect(first).toContain(MARK); // the list is computed, and cached, with his words
    await deps.erasureRequests.create(u, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    const body = await (await fetch(`${base}/today`, { headers: H })).text();
    expect(body).not.toContain(MARK);
    const cold = (JSON.parse(body) as { actions: Array<{ kind: string; clientId: string; receipt?: { quote: string | null } }> }).actions.find((a) => a.kind === 'cold');
    expect(cold).toMatchObject({ clientId: c.id, receipt: { quote: null } });
  });
});
