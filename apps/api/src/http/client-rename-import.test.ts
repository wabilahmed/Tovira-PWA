import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// [P49-2] Owner: after a rename, the old name keeps working for matching. The client's next chat is still labelled the
// old way in WhatsApp, so it must link to the same client (never a duplicate) and its speakers must be labelled the
// same way. The old name is a "previous name" (client_aliases.kind); a phone-number old name matches by phone.
let server: Server;
let base: string;
let deps: TestDeps;
beforeEach(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const h = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function rep(): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep@example.com', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const create = async (t: string, name: string) => ((await (await fetch(`${base}/clients`, { method: 'POST', headers: h(t), body: JSON.stringify({ name }) })).json()) as { id: string }).id;
const rename = (t: string, id: string, name: string) => fetch(`${base}/clients/${id}/name`, { method: 'POST', headers: h(t), body: JSON.stringify({ name }) });
const chat = (other: string, line: string) => [`13/07/2026, 9:00 am - Wabil: hi`, `13/07/2026, 9:01 am - ${other}: ${line}`].join('\n');
const importInto = (t: string, clientId: string, content: string) =>
  fetch(`${base}/clients/${clientId}/notes/import`, { method: 'POST', headers: h(t), body: JSON.stringify({ firstImportAck: true, consent: true, content }) });
const upload = (t: string, batchId: string, index: number, name: string, text: string) =>
  fetch(`${base}/import/bulk/files`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/octet-stream', 'x-tovira-batch-id': batchId, 'x-tovira-index': String(index), 'x-tovira-name': encodeURIComponent(name) }, body: new TextEncoder().encode(text) });
async function parseOne(t: string, text: string): Promise<{ state: string; matchClientId?: string; matchKind?: string }> {
  const batchId = `b${Math.random().toString(36).slice(2, 8)}`;
  await upload(t, batchId, 0, 'chat.txt', text);
  const res = await fetch(`${base}/import/bulk/parse`, { method: 'POST', headers: h(t), body: JSON.stringify({ batchId, repName: 'Wabil' }) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: { rows: Array<{ state: string; matchClientId?: string; matchKind?: string }> } }).result.rows[0]!;
}

describe('[P49-2] the old name keeps working for matching', () => {
  it('a new chat (bulk or "New client from a chat") labelled the old way links to the renamed client, not a new one', async () => {
    const { token } = await rep();
    const id = await create(token, 'Khalid Dubai Marina');
    expect((await rename(token, id, 'Abdullah Al Mansoori')).status).toBe(200);
    const row = await parseOne(token, chat('Khalid Dubai Marina', 'any news on the villa?'));
    expect(row.state).not.toBe('new');
    expect(row).toMatchObject({ state: 'possible_match', matchClientId: id });
  });

  it('a chat labelled the old way, imported on the client page, files without a misfile warning and labels the client\'s lines as the client\'s', async () => {
    const { token, userId } = await rep();
    const id = await create(token, 'Khalid Dubai Marina');
    await rename(token, id, 'Abdullah Al Mansoori');
    const res = await importInto(token, id, chat('Khalid Dubai Marina', 'any news on the villa?'));
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const [note] = await deps.notes.listByClient(userId, id);
    const theirs = note!.messages!.find((m) => m.sender === 'Khalid Dubai Marina')!; // stored verbatim: never rewritten
    expect(theirs.role).toBe('client');
    expect(note!.messages!.find((m) => m.sender === 'Wabil')!.role).toBe('rep');
  });

  it('a client first saved as a phone number, renamed, still links its next chat from that number', async () => {
    const { token } = await rep();
    const id = await create(token, '+971 50 123 4567');
    await rename(token, id, 'Khalid Al Mansoori');
    const row = await parseOne(token, chat('+971 50 123 4567', 'any news on the villa?'));
    expect(row).toMatchObject({ state: 'existing', matchClientId: id, matchKind: 'phone' });
    const page = await importInto(token, id, chat('+971 50 123 4567', 'any news on the villa?'));
    expect(page.status, await page.clone().text()).toBeLessThan(300); // no misfile warning on its own page
  });

  it('NEGATIVE: a different person who only shares a word with the old name is not linked by it', async () => {
    const { token } = await rep();
    const id = await create(token, 'Khalid Dubai Marina');
    await rename(token, id, 'Abdullah Al Mansoori');
    const row = await parseOne(token, chat('Rania Haddad', 'hello'));
    expect(row.state).toBe('new');
    expect(row.matchClientId).not.toBe(id);
  });
});
