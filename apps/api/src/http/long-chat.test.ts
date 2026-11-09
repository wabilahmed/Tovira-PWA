import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import { LONG_CHAT_MAX_MESSAGES, longChatLimit, tooLongMessage } from '../services/import/long-chat.js';

/**
 * [P67-1 · owner] A chat too long to read in one go is refused BEFORE it is read: nothing is stored, nothing is sent
 * to the model, and the rep reads why. It applies to the single upload ("Choose the chat export" on a client) and to
 * the import review (one row refused, the others import). It counts what would be read: the new messages only.
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

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
async function createClient(token: string, name: string): Promise<string> {
  const res = await fetch(`${base}/clients`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  return ((await res.json()) as { id: string }).id;
}
/** An Android export of `n` messages between Wabil and `other`, starting at message `from`. */
function chat(other: string, n: number, from = 0): string {
  const out: string[] = [];
  for (let i = from; i < from + n; i += 1) {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 60_000);
    const dd = String(d.getUTCDate()).padStart(2, '0'); const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0'); const mi = String(d.getUTCMinutes()).padStart(2, '0');
    out.push(`${dd}/${mm}/${d.getUTCFullYear()}, ${hh}:${mi} - ${i % 2 === 0 ? 'Wabil' : other}: message number ${i}`);
  }
  return out.join('\n');
}
const importRaw = (token: string, clientId: string, text: string) =>
  fetch(`${base}/clients/${clientId}/notes/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-tovira-consent': '1', 'x-tovira-first-import-ack': '1' },
    body: Buffer.from(text),
  });
const notesOf = async (token: string, cid: string) =>
  ((await (await fetch(`${base}/clients/${cid}/notes`, { headers: { authorization: `Bearer ${token}` } })).json()) as { notes: Array<{ id: string }> }).notes;
const post = (path: string, token: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const upload = (token: string, batchId: string, index: number, name: string, text: string) =>
  fetch(`${base}/import/bulk/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-tovira-batch-id': batchId, 'x-tovira-index': String(index), 'x-tovira-name': encodeURIComponent(name) },
    body: Buffer.from(text),
  });

describe('[P67-1] a chat too long to read in one go is refused before it is read', () => {
  it('the limit is 5,000 messages with windowing off, and none with it on', () => {
    expect(LONG_CHAT_MAX_MESSAGES).toBe(5_000);
    expect(longChatLimit(false)).toBe(5_000);
    expect(longChatLimit(true)).toBeNull();
  });

  it('the message says how long, the limit, and the way out; no em-dash', () => {
    const m = tooLongMessage(6_240, 5_000);
    expect(m).toBe("This chat is too long to read in one go: 6,240 messages, and the limit for now is 5,000. WhatsApp can't export part of a chat, so contact us at hello@tovira.io and we'll help.");
    expect(m).not.toMatch(/—/);
  });

  it('single upload: over the limit is refused (413) and stores nothing', async () => {
    const token = await signup('long-single@example.com');
    const cid = await createClient(token, 'Layla');
    const res = await importRaw(token, cid, chat('Layla', LONG_CHAT_MAX_MESSAGES + 1));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; message: string; messageCount: number; limit: number };
    expect(body.error).toBe('too_long');
    expect(body.messageCount).toBe(LONG_CHAT_MAX_MESSAGES + 1);
    expect(body.message).toBe(tooLongMessage(LONG_CHAT_MAX_MESSAGES + 1, LONG_CHAT_MAX_MESSAGES));
    expect(await notesOf(token, cid)).toEqual([]);
  });

  it('single upload: exactly the limit is read as before', async () => {
    const token = await signup('long-single-ok@example.com');
    const cid = await createClient(token, 'Layla');
    const res = await importRaw(token, cid, chat('Layla', LONG_CHAT_MAX_MESSAGES));
    expect(res.status).toBe(202);
  });

  it('a re-export counts only the new messages', async () => {
    const token = await signup('long-reexport@example.com');
    const cid = await createClient(token, 'Layla');
    expect((await importRaw(token, cid, chat('Layla', 4_000))).status).toBe(202);
    // 6,000 messages in the file, 2,000 of them new: read
    expect((await importRaw(token, cid, chat('Layla', 6_000))).status).toBe(202);
  });

  it('import review: the long chat is a "too_long" row, never imported; the other chat imports', async () => {
    const token = await signup('long-bulk@example.com');
    expect((await upload(token, 'lb1', 0, 'long.txt', chat('Layla', LONG_CHAT_MAX_MESSAGES + 1))).status).toBe(200);
    expect((await upload(token, 'lb1', 1, 'short.txt', chat('Omar', 20))).status).toBe(200);
    const parsed = await post('/import/bulk/parse', token, { batchId: 'lb1', repName: 'Wabil' });
    const rows = ((await parsed.json()) as { result: { rows: Array<{ fileName: string; state: string; messageCount?: number; limit?: number }> } }).result.rows;
    const long = rows.find((r) => r.fileName === 'long.txt')!;
    expect(long.state).toBe('too_long');
    expect(long.messageCount).toBe(LONG_CHAT_MAX_MESSAGES + 1);
    expect(long.limit).toBe(LONG_CHAT_MAX_MESSAGES);
    expect(rows.find((r) => r.fileName === 'short.txt')!.state).toBe('new');

    // Even if a client sends a decision for it, the long chat is never read or stored.
    const res = await post('/import/bulk', token, { batchId: 'lb1', firstImportAck: true, decisions: [
      { fileName: 'long.txt', action: 'new', name: 'Layla' },
      { fileName: 'short.txt', action: 'new', name: 'Omar' },
    ] });
    expect(res.status).toBe(202);
    let clients: Array<{ name: string }> = [];
    for (let i = 0; i < 100; i += 1) {
      clients = ((await (await fetch(`${base}/clients`, { headers: { authorization: `Bearer ${token}` } })).json()) as { clients: Array<{ name: string }> }).clients;
      if (clients.some((c) => c.name === 'Omar')) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(clients.map((c) => c.name)).toEqual(['Omar']);
  });
});
