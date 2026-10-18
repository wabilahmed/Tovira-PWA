import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [P21-D / BULK-08] Integration: a 3-file bulk import ends in exactly ONE import_complete notification
 * (the batch aggregate — never one per chat, even when the sweep settles a batch note) and ONE scan: the
 * notification opens the Book Scan, and that single scan covers all three chats. test-deps wires the same
 * BulkBatchNotifier + ImportCompletionService as index.ts.
 */
let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const chat = (other: string) => [`13/07/2019, 1:00 am - Wabil: hi`, `13/07/2019, 1:01 am - ${other}: hello about the Marina quote`].join('\n');
const authH = (t: string) => ({ authorization: `Bearer ${t}` });
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user?: { id: string }; userId?: string };
  const me = (await (await fetch(`${base}/auth/me`, { headers: authH(b.token) })).json()) as { id?: string; user?: { id: string } };
  return { token: b.token, userId: b.user?.id ?? b.userId ?? me.user?.id ?? me.id ?? '' };
}
const upload = (token: string, batchId: string, index: number, name: string, text: string) =>
  fetch(`${base}/import/bulk/files`, {
    method: 'POST',
    headers: { ...authH(token), 'content-type': 'application/octet-stream', 'x-tovira-batch-id': batchId, 'x-tovira-index': String(index), 'x-tovira-name': encodeURIComponent(name) },
    body: new TextEncoder().encode(text),
  });
async function pollDone(token: string, batchId: string): Promise<{ done: boolean; summary?: { chatsImported: number } }> {
  for (let i = 0; i < 100; i += 1) {
    const s = (await (await fetch(`${base}/import/bulk/${batchId}/status`, { headers: authH(token) })).json()) as { done: boolean; summary?: { chatsImported: number } };
    if (s.done) return s;
    await deps.runSweep(1); // the sweep runs alongside — it must not add per-chat notifications
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('batch never finished');
}

describe('[P21-D / BULK-08] a 3-file batch → one notification, one scan', () => {
  it('exactly one import_complete notification and one Book Scan covering all three chats', async () => {
    const { token, userId } = await signup('bulk08@example.com');
    expect(userId).toBeTruthy();
    await upload(token, 'b08', 0, 'a.txt', chat('Layla'));
    await upload(token, 'b08', 1, 'b.txt', chat('Omar'));
    await upload(token, 'b08', 2, 'c.txt', chat('Noor'));
    const res = await fetch(`${base}/import/bulk`, { method: 'POST', headers: { ...authH(token), 'content-type': 'application/json' }, body: JSON.stringify({ batchId: 'b08', firstImportAck: true, decisions: [
      { fileName: 'a.txt', action: 'new', name: 'Layla' },
      { fileName: 'b.txt', action: 'new', name: 'Omar' },
      { fileName: 'c.txt', action: 'new', name: 'Noor' },
    ] }) });
    expect(res.status).toBe(202);
    const final = await pollDone(token, 'b08');
    expect(final.summary?.chatsImported).toBe(3);
    await deps.runSweep(2); // any straggling sweep pass after the batch

    const importDone = (await deps.notifications.listByUser(userId)).filter((n) => n.type === 'import_complete');
    expect(importDone).toHaveLength(1);
    expect(importDone[0]!.body).toMatch(/^Imported 3 chats — .* Open the Book Scan\.$/);
    expect(importDone[0]!.dedupeKey).toMatch(/^bulk:/); // the batch aggregate, not a per-chat import:<noteId>
    expect(importDone[0]!.clientId).toBeNull();

    const scan = (await (await fetch(`${base}/book-scan`, { headers: authH(token) })).json()) as { chatsRead: number };
    expect(scan.chatsRead).toBe(3); // one scan covers the whole batch
  });

  it('NEGATIVE: a single (non-bulk) chat import still gets its own per-chat notification', async () => {
    const { token, userId } = await signup('bulk08-single@example.com');
    const cid = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: { ...authH(token), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Layla' }) })).json()) as { id: string }).id;
    const imp = await fetch(`${base}/clients/${cid}/notes/import`, { method: 'POST', headers: { ...authH(token), 'content-type': 'application/json' }, body: JSON.stringify({ consent: true, firstImportAck: true, content: chat('Layla') }) });
    expect([200, 201, 202]).toContain(imp.status);
    await deps.runSweep(2);
    const importDone = (await deps.notifications.listByUser(userId)).filter((n) => n.type === 'import_complete');
    expect(importDone).toHaveLength(1);
    expect(importDone[0]!.dedupeKey).toMatch(/^import:/);
    expect(importDone[0]!.clientId).toBe(cid);
  });
});
