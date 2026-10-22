import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [P40-1] A promise whose date the resolver couldn't read waits in Needs your answer: GET /confirmations carries it
 * in `datesToConfirm` (with its phrase, its receipt and a suggested date only when the resolver has one). The rep
 * answers with a date (PATCH dueDate — recorded as the rep's edit, so no backfill ever touches it), "Not sure" or
 * "No due date". Until then it has no date anywhere: never Overdue, never in Missed promises or Due this week.
 */
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

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
type Card = { id: string; text: string; dueRaw: string; dueDate: string | null; dateStatus: string; clientName: string; suggestedDate: string | null; receipt: { quote: string } };

async function seed(userId: string, dueRaw = 'Sunday morning', sourceMessageAt: string | null = '2026-10-10T10:05') {
  const c = await deps.clients.create(userId, 'Sara Khan');
  await deps.facts.saveExtraction(userId, { noteId: 'n1', clientId: c.id, promises: [
    { text: 'Send the floor plans', owner: 'rep', due_date: null, due_raw: dueRaw, confidence: 'high', source_span: "Sure, I'll send them Sunday morning", source_message_at: sourceMessageAt, date_status: 'to_confirm' },
  ] });
  return (await deps.facts.listPromisesByUser(userId))[0]!;
}
const cards = async (token: string) => ((await (await fetch(`${base}/confirmations`, { headers: H(token) })).json()) as { datesToConfirm: Card[] }).datesToConfirm;

describe('[P40-1] dates to confirm', () => {
  it('GET /confirmations lists it with its phrase, receipt, client and the resolver\'s suggested date', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId);
    const [card] = await cards(token);
    expect(card).toMatchObject({ text: 'Send the floor plans', dueRaw: 'Sunday morning', dueDate: null, dateStatus: 'to_confirm', clientName: 'Sara Khan', suggestedDate: '2026-10-11', receipt: { quote: "Sure, I'll send them Sunday morning" } });
  });

  it('no suggested date when the resolver has none', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId, 'soon');
    expect((await cards(token))[0]!.suggestedDate).toBeNull();
  });

  it('answering with a date stores it, clears the question, and is recorded as the rep\'s edit', async () => {
    const { token, userId } = await signup('a@example.com');
    const p = await seed(userId);
    const res = await fetch(`${base}/promises/${p.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ dueDate: '2026-10-11' }) });
    expect(res.status).toBe(200);
    const after = (await deps.facts.getPromise(userId, p.id))!;
    expect(after.dueDate).toBe('2026-10-11');
    expect(after.dateStatus).toBeNull();
    expect(await cards(token)).toEqual([]);
  });

  it('"Not sure" and "No due date" are answers too: off the queue, still undated', async () => {
    const { token, userId } = await signup('a@example.com');
    const p = await seed(userId);
    for (const answer of ['not_sure', 'no_due_date']) {
      expect((await fetch(`${base}/promises/${p.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ dateStatus: answer }) })).status).toBe(200);
      const after = (await deps.facts.getPromise(userId, p.id))!;
      expect(after.dateStatus).toBe(answer);
      expect(after.dueDate).toBeNull();
      expect(await cards(token)).toEqual([]);
    }
  });

  it('negative: any other dateStatus is refused; another rep cannot answer it', async () => {
    const a = await signup('a@example.com');
    const b = await signup('b@example.com');
    const p = await seed(a.userId);
    expect((await fetch(`${base}/promises/${p.id}`, { method: 'PATCH', headers: H(a.token), body: JSON.stringify({ dateStatus: 'whenever' }) })).status).toBe(400);
    expect((await fetch(`${base}/promises/${p.id}`, { method: 'PATCH', headers: H(b.token), body: JSON.stringify({ dueDate: '2026-10-11' }) })).status).toBe(404);
  });

  it('negative: until answered it is never Overdue, never in Missed promises or Due this week', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId);
    for (const q of ['missed-promises', 'due-this-week']) {
      const body = (await (await fetch(`${base}/find/${q}`, { headers: H(token) })).json()) as { count: number };
      expect(body.count).toBe(0);
    }
    const today = (await (await fetch(`${base}/today`, { headers: H(token) })).json()) as { actions: Array<{ title?: string }> };
    expect(today.actions.some((a) => a.title === 'Send the floor plans')).toBe(false);
  });
});
