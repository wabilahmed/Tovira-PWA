import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

// [P50-0] A card number split over two messages is a Tier-1 value: neither half may be stored, through either import path
// (a chat on the client page, or bulk / New client from a chat). Imports redact message by message, so the split has to
// be joined across messages.
let server: Server; let base: string; let deps: TestDeps;
beforeEach(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const CHAT = ['13/07/2026, 9:00 am - Wabil: can you send the card for the deposit?', '13/07/2026, 9:01 am - Omar: first half 4539 1488', '13/07/2026, 9:01 am - Omar: second half 0343 6467'].join('\n');
const h = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function rep(): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
// Only the stored CONTENT (raw text and every message body): ids and timestamps are random digits and can contain a
// fragment by chance (a note id "02414889-…" once did), which says nothing about the card.
type Stored = Array<{ rawText: string | null; messages: Array<{ body: string }> | null }>;
const contentOf = (notes: Stored): string => notes.map((n) => [n.rawText ?? '', ...(n.messages ?? []).map((m) => m.body)].join('\n')).join('\n');
const noFragments = (stored: string) => { for (const f of ['4539', '1488', '0343']) expect(stored, `fragment ${f} stored`).not.toContain(f); };

describe('[P50-0] imports never store a split card', () => {
  it('a chat imported on the client page', async () => {
    const { token, userId } = await rep();
    const id = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(token), body: JSON.stringify({ name: 'Omar' }) })).json()) as { id: string }).id;
    const res = await fetch(`${base}/clients/${id}/notes/import`, { method: 'POST', headers: h(token), body: JSON.stringify({ firstImportAck: true, consent: true, content: CHAT }) });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const stored = contentOf(await deps.notes.listByClient(userId, id));
    noFragments(stored);
    expect(stored).toContain('[card ending 6467]');
  });

  it('a chat imported in bulk', async () => {
    const { token, userId } = await rep();
    await fetch(`${base}/import/bulk/files`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-tovira-batch-id': 'b1', 'x-tovira-index': '0', 'x-tovira-name': 'chat.txt' }, body: new TextEncoder().encode(CHAT) });
    const res = await fetch(`${base}/import/bulk`, { method: 'POST', headers: h(token), body: JSON.stringify({ batchId: 'b1', decisions: [{ fileName: 'chat.txt', action: 'new', name: 'Omar' }], firstImportAck: true }) });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    for (let i = 0; i < 100 && (await deps.clients.listByUser(userId)).length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    let stored = '';
    for (let i = 0; i < 100; i++) {
      const [c] = await deps.clients.listByUser(userId);
      stored = c ? contentOf(await deps.notes.listByClient(userId, c.id)) : '';
      if (stored.includes('second half')) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(stored).toContain('second half');
    noFragments(stored);
  });
});
