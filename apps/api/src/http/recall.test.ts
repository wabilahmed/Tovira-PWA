import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

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

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

async function seedNote(token: string, text: string): Promise<void> {
  const cid = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Gulf RE' }) })).json()) as { id: string }).id;
  const note = (await (await fetch(`${base}/clients/${cid}/notes/paste`, { method: 'POST', headers: auth(token), body: JSON.stringify({ text }) })).json()) as { id: string };
  await fetch(`${base}/notes/${note.id}/extract`, { method: 'POST', headers: auth(token) }); // embeds the note
}

function ask(token: string, question: string): Promise<Response> {
  return fetch(`${base}/recall`, { method: 'POST', headers: auth(token), body: JSON.stringify({ question }) });
}

describe('[P4-8] conversational recall', () => {
  it('requires auth', async () => {
    expect((await fetch(`${base}/recall`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  });

  it('rejects an empty question', async () => {
    const token = await signup('empty-q@example.com');
    expect((await ask(token, '   ')).status).toBe(400);
  });

  it('answers from the rep\'s notes, returning a verbatim receipt', async () => {
    const token = await signup('recall@example.com');
    await seedNote(token, 'Ahmed said the pricing is too high for the villas project.');
    const body = (await (await ask(token, 'What did Ahmed say about pricing?')).json()) as { answer: string; receipts: Array<{ quote: string; date: string }> };
    expect(body.receipts.length).toBeGreaterThan(0);
    expect(body.receipts[0]!.quote).toContain('pricing is too high');
    expect(body.receipts[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // TRUST RULE: a rep with nothing on record gets an honest "I don't have that".
  it('says "I don\'t have that" when there is nothing relevant', async () => {
    const token = await signup('nothing@example.com');
    const body = (await (await ask(token, 'What did we agree about Mars?')).json()) as { answer: string; receipts: unknown[] };
    expect(body.answer).toMatch(/don't have that on record/i);
    expect(body.receipts).toEqual([]);
  });

  // TRUST RULE: retrieval never crosses tenants.
  it('never retrieves another rep\'s notes', async () => {
    const a = await signup('a-recall@example.com');
    await seedNote(a, "A's secret: the deal closes for 2 million.");
    const b = await signup('b-recall@example.com');
    const body = (await (await ask(b, 'what is the deal value?')).json()) as { receipts: unknown[] };
    expect(body.receipts).toEqual([]); // B sees none of A's notes
  });
});
