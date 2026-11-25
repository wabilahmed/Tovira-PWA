import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P40-1 · owner] Meetings get the same question card: "When is the meeting with Sara Khan?" — the phrase, when it
 * was said, a suggested time only when the resolver has one, a picker, Not sure and No date yet; the same 90-day limit.
 */
let server: Server; let base: string; let deps: TestDeps;
beforeEach(async () => { deps = buildInMemoryDeps(); server = createApiServer(deps); await listenForTest(server); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });
const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string) {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 16);
/** [P87-4 · owner, 25 Nov] Relative dates: a card shows only for a meeting said in the last 90 days, so fixed dates in
 *  October 2026 stopped listing in January 2027 (and "the card clears" then passed for no reason). The most recent given
 *  weekday that is 7 to 13 days ago, and a day after it, as 'YYYY-MM-DD'. */
const weekdayAgo = (dow: number) => { const d = new Date(Date.now() - 7 * 86_400_000); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7)); return d.toISOString().slice(0, 10); };
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const THU = weekdayAgo(4); // "Saturday 3pm" said on a Thursday → that Saturday
const WED = weekdayAgo(3); // "Saturday" said on a Wednesday → that Saturday
const SAT_AFTER_WED = plus(WED, 3);
type Card = { id: string; clientName: string; datetimeRaw: string; datetime: string | null; dateStatus: string; suggestedDatetime: string | null };
const cards = async (t: string) => ((await (await fetch(`${base}/confirmations`, { headers: H(t) })).json()) as { meetingDatesToConfirm: Card[] }).meetingDatesToConfirm;

async function seed(userId: string, raw: string, saidAt: string) {
  const c = await deps.clients.create(userId, 'Sara Khan');
  return deps.meetings.create(userId, { clientId: c.id, datetime: null, datetimeRaw: raw, title: null, confirmed: false, noteId: 'n1', sourceSpan: `see you ${raw}`, sourceMessageAt: saidAt, captureAt: saidAt.slice(0, 10), dateStatus: 'to_confirm' });
}

describe('[P40-1] meetings to confirm', () => {
  it('listed with the phrase and the resolver\'s suggested time', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId, 'Saturday 3pm', `${THU}T10:00`); // a Thursday → that Saturday, 15:00
    const [m] = await cards(token);
    expect(m).toMatchObject({ clientName: 'Sara Khan', datetimeRaw: 'Saturday 3pm', datetime: null, dateStatus: 'to_confirm', suggestedDatetime: `${plus(THU, 2)}T15:00` });
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

  // [P40-1 · owner] giving the time confirms the meeting; "Not sure" leaves it unconfirmed
  it('answering with a time also confirms the meeting', async () => {
    const { token, userId } = await signup('a@example.com');
    const m = await seed(userId, 'Saturday afternoon', ago(2));
    await fetch(`${base}/meetings/${m.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ datetime: '2026-10-24T15:00' }) });
    const after = (await deps.meetings.listByUser(userId))[0]!;
    expect(after.confirmed).toBe(true);
    expect(after.dateStatus).toBeNull();
  });

  it('negative: "Not sure" leaves it unconfirmed', async () => {
    const { token, userId } = await signup('a@example.com');
    const m = await seed(userId, 'Saturday afternoon', ago(2));
    await fetch(`${base}/meetings/${m.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ dateStatus: 'not_sure' }) });
    expect((await deps.meetings.listByUser(userId))[0]!.confirmed).toBe(false);
  });

  it('negative: rescheduling a meeting that was not waiting on the question does not confirm it', async () => {
    const { token, userId } = await signup('a@example.com');
    const c = await deps.clients.create(userId, 'Omar Ali');
    const m = await deps.meetings.create(userId, { clientId: c.id, datetime: '2026-10-25T11:00:00.000Z', datetimeRaw: 'Sunday 3pm', title: null, confirmed: false, noteId: 'n2' });
    await fetch(`${base}/meetings/${m.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ datetime: '2026-10-26T15:00' }) });
    expect((await deps.meetings.listByUser(userId)).find((x) => x.id === m.id)!.confirmed).toBe(false);
  });
});

// [P43-7 · owner] A meeting said as "Saturday" keeps its day and asks only for the time. The day is the one the
// shared resolver reads for a promise, anchored to the meeting's own message; nothing new is stored.
describe('[P43-7] date-only meetings keep their day', () => {
  it('"Saturday" said on a Wednesday → that Saturday on the card and in the meetings list', async () => {
    const { token, userId } = await signup('a@example.com');
    const m = await seed(userId, 'Saturday', `${WED}T10:00`);
    expect((await cards(token))[0]).toMatchObject({ id: m.id, datetime: null, day: SAT_AFTER_WED, suggestedDatetime: null });
    const list = ((await (await fetch(`${base}/meetings`, { headers: H(token) })).json()) as { meetings: Array<{ id: string; day: string | null }> }).meetings;
    expect(list.find((x) => x.id === m.id)?.day).toBe(SAT_AFTER_WED);
  });

  it('answering with a time on that day sets it and confirms the meeting', async () => {
    const { token, userId } = await signup('a@example.com');
    const m = await seed(userId, 'Saturday', `${WED}T10:00`);
    expect((await fetch(`${base}/meetings/${m.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ datetime: `${SAT_AFTER_WED}T15:00` }) })).status).toBe(200);
    const after = (await deps.meetings.findByIdForUser(userId, m.id))!;
    expect(after).toMatchObject({ confirmed: true, dateStatus: null });
    expect(after.datetime).not.toBeNull();
    expect(await cards(token)).toEqual([]);
  });

  it('NEGATIVE: "next Tuesday" and "the 5th" stay without a day, as now', async () => {
    const { token, userId } = await signup('a@example.com');
    await seed(userId, 'next Tuesday', `${WED}T10:00`);
    await seed(userId, 'the 5th', `${WED}T10:00`);
    expect((await cards(token)).map((c) => (c as Card & { day: string | null }).day)).toEqual([null, null]);
  });

  it('NEGATIVE: the day is never stored, and a meeting with no anchor gets no day', async () => {
    const { token, userId } = await signup('a@example.com');
    const c = await deps.clients.create(userId, 'Omar Ali');
    const m = await deps.meetings.create(userId, { clientId: c.id, datetime: null, datetimeRaw: 'Saturday', title: null, confirmed: false, noteId: 'n2', sourceSpan: null, sourceMessageAt: null, captureAt: null, dateStatus: 'to_confirm' });
    await cards(token);
    const stored = (await deps.meetings.findByIdForUser(userId, m.id))!;
    expect(stored.datetime).toBeNull();
    expect('day' in stored).toBe(false);
    const list = ((await (await fetch(`${base}/meetings`, { headers: H(token) })).json()) as { meetings: Array<{ id: string; day: string | null }> }).meetings;
    expect(list.find((x) => x.id === m.id)?.day).toBeNull();
  });
});
