import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [P40-1 · owner] Meetings get the same question card: "When is the meeting with Sara Khan?" — the phrase, when it
 * was said, a suggested time only when the resolver has one, a picker, Not sure and No date yet; the same 90-day limit.
 */
let server: Server; let base: string; let deps: TestDeps;
beforeEach(async () => { deps = buildInMemoryDeps(); server = createApiServer(deps); await new Promise<void>((r) => server.listen(0, r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });
const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string) {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 16);
type Card = { id: string; clientName: string; datetimeRaw: string; datetime: string | null; dateStatus: string; suggestedDatetime: string | null };
const cards = async (t: string) => ((await (await fetch(`${base}/confirmations`, { headers: H(t) })).json()) as { meetingDatesToConfirm: Card[] }).meetingDatesToConfirm;

async function seed(userId: string, raw: string, saidAt: string) {
  const c = await deps.clients.create(userId, 'Sara Khan');
  return deps.meetings.create(userId, { clientId: c.id, datetime: null, datetimeRaw: raw, title: null, confirmed: false, noteId: 'n1', sourceSpan: `see you ${raw}`, sourceMessageAt: saidAt, captureAt: saidAt.slice(0, 10), dateStatus: 'to_confirm' });
}

describe('[P40-1] meetings to confirm', () => {
  it('listed with the phrase and the resolver\'s suggested time', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId, 'Saturday 3pm', '2026-10-08T10:00'); // a Thursday → Sat 10 Oct, 15:00
    const [m] = await cards(token);
    expect(m).toMatchObject({ clientName: 'Sara Khan', datetimeRaw: 'Saturday 3pm', datetime: null, dateStatus: 'to_confirm', suggestedDatetime: '2026-10-10T15:00' });
  });

  it('no suggestion when the resolver has none ("Saturday afternoon" has no clock time)', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId, 'Saturday afternoon', ago(2));
    expect((await cards(token))[0]!.suggestedDatetime).toBeNull();
  });

  it('the 90-day edge: 90 days ago → a card; 91 → none', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId, 'Saturday afternoon', ago(90));
    expect(await cards(token)).toHaveLength(1);
    const b = await signup('b@example.com');
    await seed(b.userId, 'Saturday afternoon', ago(91));
    expect(await cards(b.token)).toHaveLength(0);
  });

  it('answering: a time clears it; Not sure / No date yet are answers; anything else is refused', async () => {
    const { token, userId } = await signup('a@example.com');
    const m = await seed(userId, 'Saturday afternoon', ago(2));
    expect((await fetch(`${base}/meetings/${m.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ dateStatus: 'whenever' }) })).status).toBe(400);
    expect((await fetch(`${base}/meetings/${m.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ dateStatus: 'not_sure' }) })).status).toBe(200);
    expect((await deps.meetings.listByUser(userId))[0]!.dateStatus).toBe('not_sure');
    expect(await cards(token)).toHaveLength(0);
    expect((await fetch(`${base}/meetings/${m.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ datetime: '2026-10-24T15:00' }) })).status).toBe(200);
    const after = (await deps.meetings.listByUser(userId))[0]!;
    expect(after.datetime).not.toBeNull();
    expect(after.dateStatus).toBeNull();
  });
});
