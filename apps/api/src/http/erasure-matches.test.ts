import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [P47 · found by the erasure guard] An inventory suggestion built from a requirement the restricted person stated
 * quoted their words on /inventory/matches, an item's matches and Today's match card. The erasure guard's fixture had
 * never held a match, so it never saw this. A requirement read from the restricted person is withheld everywhere, so
 * is a suggestion made from it.
 */
let server: Server;
let base: string;
let deps: TestDeps;
const DAY = 86_400_000;
const MARK = 'OBSIDIANFERN';
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[P47] a restricted person\'s requirement never surfaces through a suggestion', () => {
  it('NEGATIVE: /inventory/matches, the item\'s matches and Today never quote them', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'em1@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
    const u = b.user.id;
    const H = { authorization: `Bearer ${b.token}` };
    const c = await deps.clients.create(u, 'Marina Estates');
    const quote = `${MARK} here, looking for a 4BR villa`;
    const note = await deps.notes.create(u, { clientId: c.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', messages: [{ sentAt: '2026-01-01T10:00', sender: 'Khalid', body: quote, media: false, role: 'client' }] });
    const [req] = await deps.requirements.saveForNote(u, note.id, c.id, [{ text: '4BR villa', requirementRaw: quote, statedOn: '2026-01-01', confidence: 'high', embedding: [1, 0, 0] }]);
    const item = (await (await fetch(`${base}/inventory`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Villa list', description: 'villas', quantity: null }) })).json()) as { id: string };
    await deps.inventoryMatches.upsert(u, { requirementId: req!.id, itemId: item.id, clientId: c.id, similarity: 1, confidence: 'strong' });
    const read = async (p: string) => (await fetch(`${base}${p}`, { headers: H })).text();
    expect(await read('/inventory/matches')).toContain(MARK); // the fixture really carries it
    await deps.erasureRequests.create(u, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    for (const p of ['/inventory/matches', `/inventory/${item.id}/matches`, '/today', `/inventory/matches?clientId=${c.id}`]) {
      expect(await read(p), p).not.toContain(MARK);
    }
  });
});
