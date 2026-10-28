import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

// [P47 · found by the self-discovering erasure guard] /notes/pending read the raw notes: a pasted chat waiting for
// extraction showed the restricted person's lines. It now reads through the restriction, like every other note surface.
let server: Server; let base: string; let deps: TestDeps;
const DAY = 86_400_000; const MARK = 'QUILLHARBOR';
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[P47] pending notes honour the restriction', () => {
  it('NEGATIVE: their pasted lines leave /notes/pending; the rest of the paste stays', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pn1@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
    const u = b.user.id; const H = { authorization: `Bearer ${b.token}` };
    const c = await deps.clients.create(u, 'Marina Estates');
    await deps.notes.create(u, { clientId: c.id, source: 'paste', rawText: `Khalid: ${MARK} can we move the viewing?\nRep: sure, Friday`, audioKey: null, status: 'pending_extraction' } as never);
    const read = async () => (await fetch(`${base}/notes/pending`, { headers: H })).text();
    expect(await read()).toContain(MARK);
    await deps.erasureRequests.create(u, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    const body = await read();
    expect(body).not.toContain(MARK);
    expect(body).toContain('Rep: sure, Friday');
  });
});
