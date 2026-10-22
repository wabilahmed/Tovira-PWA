import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { StubModelClient } from '../adapters/model/stub.js';

/**
 * [P39-7] Find over HTTP: fixed questions, answered from stored data, each line with its receipt. No model is
 * called (Find never touches the allowance), tenants never see each other's rows, an erasure restriction
 * withholds the counterparty's words, and POST /recall (the free-text Ask) is gone.
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
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); vi.restoreAllMocks(); });

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
type Result = { count: number; items: Array<{ clientName: string; line: string; meta: string | null; overdue: boolean; owner: string | null; tags: string[]; receipt: { quote: string } | null }>; footnote: string | null };
const find = async (token: string, q: string, qs = ''): Promise<{ status: number; body: Result }> => {
  const res = await fetch(`${base}/find/${q}${qs}`, { headers: H(token) });
  return { status: res.status, body: (await res.json()) as Result };
};

async function seed(userId: string, name = 'Sara Khan', who = 'Sara') {
  const c = await deps.clients.create(userId, name);
  const n = await deps.notes.create(userId, { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted', messages: [
    { sender: who, sentAt: '2026-09-01T09:00', body: 'looking for a 4BR villa in Mirdif, budget around 3M', media: false, role: 'client' },
    { sender: 'Rep', sentAt: '2026-09-02T10:00', body: "I'll send the floor plans", media: false, role: 'rep' },
  ] } as never);
  await deps.requirements.saveForNote(userId, n.id, c.id, [
    { text: '4BR villa in Mirdif', requirementRaw: 'looking for a 4BR villa in Mirdif, budget around 3M', statedOn: '2026-09-01', confidence: 'high', embedding: null },
  ]);
  await deps.facts.saveExtraction(userId, { noteId: n.id, clientId: c.id, promises: [
    { text: 'Send the floor plans', owner: 'rep', due_date: day(-3), due_raw: null, confidence: 'high', source_span: "I'll send the floor plans", source_message_at: '2026-09-02T10:00' },
    { text: 'Send ID photos', owner: 'client', due_date: day(-200), due_raw: null, confidence: 'high', source_span: 'will send ID', source_message_at: '2026-03-01T10:00' }, // stale
  ] });
  return { clientId: c.id, noteId: n.id };
}

describe('[P39-7] Find answers', () => {
  it('missed promises: past due + open + not stale, labelled Yours, with due date and receipt, and the stale footnote', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId);
    const { status, body } = await find(token, 'missed-promises');
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.items[0]).toMatchObject({ clientName: 'Sara Khan', line: 'Send the floor plans', overdue: true, owner: 'rep', tags: ['Yours'], receipt: { quote: "I'll send the floor plans" } });
    expect(body.items[0]!.meta).toMatch(/^Due \d{1,2} [A-Z][a-z]{2}/);
    expect(body.footnote).toMatch(/more than 90 days overdue are kept/);
  });

  it('no-reply: "Last replied 1 Sep" with their message as the receipt', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId);
    const { body } = await find(token, 'no-reply');
    expect(body.items.map((i) => [i.clientName, i.line])).toEqual([['Sara Khan', 'Last replied 1 Sep']]);
    expect(body.items[0]!.receipt!.quote).toMatch(/4BR villa/);
  });

  it('open requirements + wanting (options only from stored values)', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId);
    expect((await find(token, 'open-requirements')).body.items.map((i) => i.line)).toEqual(['4BR Villa · Mirdif · ~AED 3M']);
    const opts = (await (await fetch(`${base}/find/wanting/options`, { headers: H(token) })).json()) as { type: string[]; area: string[]; budget: Array<{ value: string; label: string }> };
    expect(opts).toEqual({ type: ['Villa'], area: ['Mirdif'], budget: [{ value: '2m-5m', label: 'AED 2M to 5M' }] });
    expect((await find(token, 'wanting', '?by=type&value=Villa')).body.count).toBe(1);
    expect((await find(token, 'wanting', '?by=type&value=Apartment')).body.count).toBe(0);
  });

  it('negative: an unknown question is a 404; wanting needs a filter', async () => {
    const { token } = await signup('a@example.com');
    expect((await fetch(`${base}/find/what-did-sara-say`, { headers: H(token) })).status).toBe(404);
    expect((await fetch(`${base}/find/wanting`, { headers: H(token) })).status).toBe(400);
  });

  it('negative: tenants never see each other (B sees none of A\'s clients)', async () => {
    const a = await signup('a@example.com');
    const b = await signup('b@example.com');
    await seed(a.userId);
    for (const q of ['missed-promises', 'no-reply', 'open-requirements', 'cold-clients', 'active-clients']) {
      expect((await find(b.token, q)).body.count).toBe(0);
    }
  });

  it('negative: an erasure restriction withholds the counterparty\'s words', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId);
    await deps.erasureRequests.create(userId, { requesterNames: ['Sara'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    const all = JSON.stringify([(await find(token, 'no-reply')).body, (await find(token, 'open-requirements')).body]);
    expect(all).not.toMatch(/4BR villa in Mirdif, budget/);
    expect((await find(token, 'open-requirements')).body.count).toBe(0); // the wants line is their words too
    expect((await find(token, 'wanting', '?by=type&value=Villa')).body.count).toBe(0);
  });

  it('negative: Find calls no model', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId);
    const spy = vi.spyOn(StubModelClient.prototype, 'complete'); // every model client in the test deps
    for (const q of ['missed-promises', 'due-this-week', 'no-reply', 'open-requirements', 'deals-at-risk', 'active-clients', 'cold-clients']) {
      expect((await find(token, q)).status).toBe(200);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('negative: the free-text Ask (POST /recall) is gone', async () => {
    const { token } = await signup('a@example.com');
    const res = await fetch(`${base}/recall`, { method: 'POST', headers: H(token), body: JSON.stringify({ question: 'what did Sara say?' }) });
    expect(res.status).toBe(404);
  });

  it('unauthenticated → 401', async () => {
    expect((await fetch(`${base}/find/missed-promises`)).status).toBe(401);
  });
});

describe('[P39-7] "Add a note" holds a statement for confirmation (POST /captures)', () => {
  it('the note waits in To Confirm; nothing is in the book until confirmed', async () => {
    const { token, userId } = await signup('a@example.com');
    const c = await deps.clients.create(userId, 'Sara Khan');
    const res = await fetch(`${base}/captures`, { method: 'POST', headers: H(token), body: JSON.stringify({ clientId: c.id, statement: "Sara's budget is now 2.2M" }) });
    expect(res.status).toBe(201);
    const queue = (await (await fetch(`${base}/captures`, { headers: H(token) })).json()) as { captures: Array<{ statement: string; field?: string }> };
    expect(queue.captures).toHaveLength(1);
    expect(queue.captures[0]).toMatchObject({ statement: "Sara's budget is now 2.2M", field: 'budget' });
    expect(await deps.notes.listByClient(userId, c.id)).toHaveLength(0);
  });

  it('negative: an empty statement or another rep\'s client → refused', async () => {
    const a = await signup('a@example.com');
    const b = await signup('b@example.com');
    const c = await deps.clients.create(a.userId, 'Sara Khan');
    expect((await fetch(`${base}/captures`, { method: 'POST', headers: H(a.token), body: JSON.stringify({ clientId: c.id, statement: '  ' }) })).status).toBe(400);
    expect((await fetch(`${base}/captures`, { method: 'POST', headers: H(b.token), body: JSON.stringify({ clientId: c.id, statement: 'Budget is 2M' }) })).status).toBe(404);
  });

  it('negative: another rep never sees or confirms the pending note (moved from the Ask statement-capture tests)', async () => {
    const a = await signup('a@example.com');
    const c = await deps.clients.create(a.userId, 'QA Sara Khan');
    await fetch(`${base}/captures`, { method: 'POST', headers: H(a.token), body: JSON.stringify({ clientId: c.id, statement: 'QA Sara Khan increased her budget to 2.2M' }) });
    const [pending] = ((await (await fetch(`${base}/captures`, { headers: H(a.token) })).json()) as { captures: Array<{ noteId: string }> }).captures;
    const b = await signup('b@example.com');
    expect(((await (await fetch(`${base}/captures`, { headers: H(b.token) })).json()) as { captures: unknown[] }).captures).toHaveLength(0);
    expect((await fetch(`${base}/captures/${pending!.noteId}/confirm`, { method: 'POST', headers: H(b.token) })).status).toBe(404);
  });
});
