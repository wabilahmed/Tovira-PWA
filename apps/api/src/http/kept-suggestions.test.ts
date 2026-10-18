import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/** [P24-2] To Confirm "Looks like you sent it — Mark done?" end to end: list with both receipts, Mark done
 *  (promise done) + Undo (open again), Not yet (dismissed), and another rep can neither see nor act on it. */
let server: Server;
let base: string;
let deps: TestDeps;
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const get = async (t: string) => (await (await fetch(`${base}/promises/kept-suggestions`, { headers: H(t) })).json()) as { suggestions: Array<{ id: string; promiseId: string; message: string; promise: { quote: string; date: string }; delivery: { quote: string; date: string } }> };
const post = (t: string, path: string) => fetch(`${base}${path}`, { method: 'POST', headers: H(t) });

describe('[P24-2] kept-promise suggestions over HTTP', () => {
  async function setup(email: string) {
    const token = ((await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string }).token;
    const me = (await (await fetch(`${base}/me`, { headers: H(token) })).json()) as { id?: string; user?: { id: string } };
    const userId = me.user?.id ?? me.id ?? '';
    const client = await deps.clients.create(userId, 'QA P14 Gate Client');
    await deps.facts.saveExtraction(userId, { noteId: 'n1', clientId: client.id, promises: [{ text: 'Send the options', owner: 'rep', due_date: null, due_raw: 'by Thursday', confidence: 'high', source_span: "I'll send you three options by Thursday", source_message_at: '2026-03-02T10:20' }] });
    await deps.keptSuggestions.detect(userId, client.id, 'n1', [{ text: 'Send the options', owner: 'rep', due_date: null, due_raw: 'by Thursday', confidence: 'high', source_span: "I'll send you three options by Thursday", source_message_at: '2026-03-02T10:20' }],
      [{ sender: 'Wabil', sentAt: '2026-03-05T16:40', body: 'Here are the options', media: false, role: 'rep' }]);
    return { token, userId };
  }

  it('lists the suggestion with the copy and BOTH receipts; the promise is still open', async () => {
    const { token, userId } = await setup('kept-list@example.com');
    const { suggestions } = await get(token);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ message: 'Looks like you sent the options to QA P14 Gate Client. Mark done?', promise: { quote: "I'll send you three options by Thursday", date: '2026-03-02' }, delivery: { quote: 'Here are the options', date: '2026-03-05' } });
    expect((await deps.facts.listPromisesByUser(userId))[0]!.done).toBe(false);
  });

  it('Mark done → done; Undo → open again and back in the list', async () => {
    const { token, userId } = await setup('kept-done@example.com');
    const [s] = (await get(token)).suggestions;
    expect((await post(token, `/promises/kept-suggestions/${s!.id}/done`)).status).toBe(200);
    expect((await deps.facts.listPromisesByUser(userId))[0]!.done).toBe(true);
    expect((await get(token)).suggestions).toHaveLength(0);
    expect((await post(token, `/promises/kept-suggestions/${s!.id}/undo`)).status).toBe(200);
    expect((await deps.facts.listPromisesByUser(userId))[0]!.done).toBe(false);
    expect((await get(token)).suggestions).toHaveLength(1);
  });

  it('Not yet → dismissed, promise still open', async () => {
    const { token, userId } = await setup('kept-notyet@example.com');
    const [s] = (await get(token)).suggestions;
    expect((await post(token, `/promises/kept-suggestions/${s!.id}/not-yet`)).status).toBe(200);
    expect((await get(token)).suggestions).toHaveLength(0);
    expect((await deps.facts.listPromisesByUser(userId))[0]!.done).toBe(false);
  });

  it('NEGATIVE: another rep can neither see nor act on it; requires auth', async () => {
    const a = await setup('kept-owner@example.com');
    const [s] = (await get(a.token)).suggestions;
    const otherToken = ((await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'kept-other@example.com', password: 'password123' }) })).json()) as { token: string }).token;
    expect((await get(otherToken)).suggestions).toHaveLength(0);
    expect((await post(otherToken, `/promises/kept-suggestions/${s!.id}/done`)).status).toBe(404);
    expect((await deps.facts.listPromisesByUser(a.userId))[0]!.done).toBe(false);
    expect((await fetch(`${base}/promises/kept-suggestions`)).status).toBe(401);
  });
});
