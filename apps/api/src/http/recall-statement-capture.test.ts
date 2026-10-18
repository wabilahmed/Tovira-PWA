import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [P21-A3 / FEAT-06] End to end through POST /recall: a STATEMENT of fact ("remember …", "note that …",
 * "update: …", "X is now …") becomes a PENDING note on the right client, the reply says what was held
 * ("Saved for confirmation: Sara's budget → 2.2M"), and it shows in the To Confirm queue (GET /captures).
 * Retest: "Remember that QA Sara Khan increased her budget to 2.2M" → "I don't have that on record", no note.
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

const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
async function client(token: string, name: string): Promise<string> {
  return ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name }) })).json()) as { id: string }).id;
}
interface AskBody { answer: string; receipts: unknown[]; capture?: { status: string; clientName?: string; noteId?: string; summary?: string; candidates?: string[] } }
async function ask(token: string, question: string): Promise<AskBody> {
  return (await (await fetch(`${base}/recall`, { method: 'POST', headers: auth(token), body: JSON.stringify({ question }) })).json()) as AskBody;
}
async function queue(token: string): Promise<Array<{ noteId: string; clientId: string; clientName: string; statement: string; summary?: string }>> {
  return ((await (await fetch(`${base}/captures`, { headers: auth(token) })).json()) as { captures: Array<{ noteId: string; clientId: string; clientName: string; statement: string; summary?: string }> }).captures;
}

describe('[P21-A3] a statement in Ask becomes a pending note on the right client', () => {
  it('"Remember that QA Sara Khan increased her budget to 2.2M" → pending note, "Saved for confirmation", in To Confirm', async () => {
    const token = await signup('a3-sara@example.com');
    const sara = await client(token, 'QA Sara Khan');
    await client(token, 'QA P14 Gate Client');
    const body = await ask(token, 'Remember that QA Sara Khan increased her budget to 2.2M');
    expect(body.answer).not.toMatch(/don't have that on record/i);
    expect(body.answer).toBe("Saved for confirmation: Sara's budget → 2.2M");
    expect(body.capture?.status).toBe('captured');
    expect(body.capture?.clientName).toBe('QA Sara Khan');
    expect(body.capture?.noteId).toBeTruthy();
    const q = await queue(token);
    expect(q).toHaveLength(1);
    expect(q[0]!.clientId).toBe(sara);
    expect(q[0]!.statement).toBe('Remember that QA Sara Khan increased her budget to 2.2M'); // verbatim receipt
    expect(q[0]!.summary).toBe("Sara's budget → 2.2M");
    // Nothing is in the vault until confirmed; confirm commits it and empties the queue.
    expect((await fetch(`${base}/captures/${q[0]!.noteId}/confirm`, { method: 'POST', headers: auth(token) })).status).toBe(200);
    expect(await queue(token)).toHaveLength(0);
  });

  for (const [turn, summary] of [
    ['Note that QA Sara Khan prefers calls after 5pm', 'QA Sara Khan: prefers calls after 5pm'],
    ['Update: Sara\'s budget is 2.4M', "Sara's budget → 2.4M"],
    ['Sara\'s budget is now 2.5M', "Sara's budget → 2.5M"],
  ] as const) {
    it(`"${turn}" is captured on QA Sara Khan`, async () => {
      const token = await signup(`a3-${Math.random().toString(36).slice(2)}@example.com`);
      const sara = await client(token, 'QA Sara Khan');
      await client(token, 'QA P14 Gate Client');
      const body = await ask(token, turn);
      expect(body.capture?.status).toBe('captured');
      expect(body.answer).toBe(`Saved for confirmation: ${summary}`);
      const q = await queue(token);
      expect(q.map((c) => c.clientId)).toEqual([sara]);
    });
  }

  it('an ambiguous client → asks which, stores nothing', async () => {
    const token = await signup('a3-ambig@example.com');
    await client(token, 'Sara Khan');
    await client(token, 'Sara Malik');
    const body = await ask(token, 'Remember that Sara increased her budget to 2.2M');
    expect(body.capture?.status).toBe('needs_client');
    expect(body.capture?.candidates?.sort()).toEqual(['Sara Khan', 'Sara Malik']);
    expect(body.answer).toMatch(/which client/i);
    expect(await queue(token)).toHaveLength(0);
  });

  it('no client named → asks which, stores nothing', async () => {
    const token = await signup('a3-none@example.com');
    await client(token, 'QA Sara Khan');
    const body = await ask(token, 'Remember that the budget went up to 2.2M');
    expect(body.capture?.status).toBe('needs_client');
    expect(await queue(token)).toHaveLength(0);
  });

  // NEGATIVE — questions must never become facts.
  for (const turn of ['Do you remember QA Sara Khan\'s budget?', 'Remember what QA Sara Khan said about the budget?', 'What is QA Sara Khan\'s budget now?', 'Is QA Sara Khan now on 2.2M?']) {
    it(`NEGATIVE: "${turn}" is a question — nothing captured`, async () => {
      const token = await signup(`a3n-${Math.random().toString(36).slice(2)}@example.com`);
      await client(token, 'QA Sara Khan');
      const body = await ask(token, turn);
      expect(body.capture?.status ?? 'none').toBe('none');
      expect(await queue(token)).toHaveLength(0);
    });
  }

  it('NEGATIVE: another rep never sees or confirms the pending note', async () => {
    const a = await signup('a3-owner@example.com');
    await client(a, 'QA Sara Khan');
    await ask(a, 'Remember that QA Sara Khan increased her budget to 2.2M');
    const [pending] = await queue(a);
    const b = await signup('a3-other@example.com');
    expect(await queue(b)).toHaveLength(0);
    expect((await fetch(`${base}/captures/${pending!.noteId}/confirm`, { method: 'POST', headers: auth(b) })).status).toBe(404);
  });
});
