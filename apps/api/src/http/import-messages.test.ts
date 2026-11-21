import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P83 · owner, 21 Nov] A chat with more messages to read than the rep has left is refused before anything is stored
 * (no model call), with the messages line, never a cost. The preview says so before the rep confirms. A chat that fits is
 * imported, and its messages are counted once it is read.
 */
let server: Server; let base: string; let deps: TestDeps;
beforeAll(async () => { deps = buildInMemoryDeps(); server = createApiServer(deps); await listenForTest(server); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

// [P84-5 · owner, 22 Nov] pins moved: a trial now has 5,000 messages, so the plan's 10,000 is tested on a subscriber
// (the webhook below); the trial has its own cases at the end. [P84-8] the rep's time zone is set at signup.
async function rep(email: string, opts: { trial?: boolean; timezone?: string } = {}) {
  const s = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', ...(opts.timezone ? { timezone: opts.timezone } : {}) }) })).json()) as { token: string; user: { id: string } };
  if (!opts.trial) await fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 'whsec_test', 'content-type': 'application/json' }, body: JSON.stringify({ id: `evt_sub_${s.user.id}`, type: 'checkout.session.completed', userId: s.user.id }) });
  const c = (await (await fetch(`${base}/clients`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sara Lee' }) })).json()) as { id: string };
  return { token: s.token, userId: s.user.id, clientId: c.id };
}
const line = (i: number, body: string) => `[2026-01-${String(1 + (i % 28)).padStart(2, '0')}, ${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00] ${i % 2 ? 'Alex Rep' : 'Sara Lee'}: ${body}`;
const exportOf = (n: number) => Array.from({ length: n }, (_, i) => line(i, `message number ${i}`)).join('\n');
const post = (token: string, clientId: string, text: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/clients/${clientId}/notes/import`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'X-Tovira-Consent': '1', 'X-Tovira-First-Import-Ack': '1', 'X-Tovira-Confirm-Import': '1', ...headers }, body: new TextEncoder().encode(text) });
async function useMessages(userId: string, n: number) { expect(await deps.allowanceStatus.chargeMessages(userId, `seed-${userId}-${n}`, n)).toBe(true); }

describe('[P83] imports and the messages left', () => {
  it('NEGATIVE: a chat bigger than what is left is refused, nothing stored, with the messages line', async () => {
    const r = await rep('im1@x.io');
    await useMessages(r.userId, 9800);
    const res = await post(r.token, r.clientId, exportOf(240));
    expect(res.status).toBe(402);
    const b = (await res.json()) as { error: string; message: string };
    expect(b.error).toBe('out_of_messages');
    expect(b.message).toBe('This chat has 240 messages to read. You have 200 left this month. Add more messages to import it now.');
    expect(b.message).not.toMatch(/AED|\$|cost|spend|%/i);
    expect(await deps.notes.listByClient(r.userId, r.clientId)).toEqual([]);
  });
  it('NEGATIVE: with none left, the run-out line: "You\'ve read your 10,000 messages this month. Resets <date>."', async () => {
    const r = await rep('im2@x.io');
    await useMessages(r.userId, 10_000);
    const b = (await (await post(r.token, r.clientId, exportOf(5))).json()) as { message: string };
    expect(b.message).toMatch(/^You've read your 10,000 messages this month\. Resets \d{1,2} [A-Z][a-z]{2}\. Add more messages to import it now\.$/);
  });
  it('the preview says it before the rep confirms', async () => {
    const r = await rep('im3@x.io');
    await useMessages(r.userId, 9800);
    const b = (await (await post(r.token, r.clientId, exportOf(240), { 'X-Tovira-Preview': '1' })).json()) as Record<string, unknown>;
    expect(b).toMatchObject({ preview: true, messagesToRead: 240, notEnough: true, messagesLeft: 200, notEnoughLine: 'This chat has 240 messages to read. You have 200 left this month.' });
  });
  it('a chat that fits is imported; its messages are counted when it is read, once', async () => {
    const r = await rep('im4@x.io');
    await useMessages(r.userId, 9000);
    expect((await post(r.token, r.clientId, exportOf(240))).status).toBeLessThan(300);
    await deps.runSweep();
    await deps.runSweep();
    expect((await deps.allowanceStatus.status(r.userId)).messagesUsed).toBe(9240);
  });
  it('a typed note never counts against the messages', async () => {
    const r = await rep('im5@x.io');
    await useMessages(r.userId, 10_000);
    const res = await fetch(`${base}/clients/${r.clientId}/notes/paste`, { method: 'POST', headers: { authorization: `Bearer ${r.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Met Sara, she wants a 3 bed in the Marina.' }) });
    expect(res.status).toBe(201);
    await deps.runSweep();
    expect((await deps.allowanceStatus.status(r.userId)).messagesUsed).toBe(10_000);
  });
});

describe('[P84-5] a trial: 5,000 messages, in trial words', () => {
  it('a trial rep can read 5,000, not 10,000', async () => {
    const r = await rep('im-t1@x.io', { trial: true });
    const s = await deps.allowanceStatus.status(r.userId);
    expect([s.messagesAllowance, s.messagesLeft]).toEqual([5000, 5000]);
  });
  it('NEGATIVE: too big for what the trial has left: refused, nothing stored, with the trial line', async () => {
    const r = await rep('im-t2@x.io', { trial: true });
    await useMessages(r.userId, 4800);
    const b = (await (await post(r.token, r.clientId, exportOf(240))).json()) as { error: string; message: string };
    expect(b.error).toBe('out_of_messages');
    expect(b.message).toBe('This chat has 240 messages to read. You have 200 left in your trial. Subscribe to import it now.');
    expect(await deps.notes.listByClient(r.userId, r.clientId)).toEqual([]);
  });
  it('NEGATIVE: none left: "You\'ve read your 5,000 trial messages." (no reset date: a trial does not reset)', async () => {
    const r = await rep('im-t3@x.io', { trial: true });
    await useMessages(r.userId, 5000);
    const b = (await (await post(r.token, r.clientId, exportOf(5))).json()) as { message: string };
    expect(b.message).toBe("You've read your 5,000 trial messages. Subscribe to import it now.");
  });
});

describe('[P84-8] "Resets <date>" is the rep\'s own day', () => {
  it('a rep in New York and a rep in Dubai each see the reset day in their own time zone', async () => {
    const ny = await rep('im-tz1@x.io', { timezone: 'America/New_York' });
    const dxb = await rep('im-tz2@x.io', { timezone: 'Asia/Dubai' });
    await useMessages(ny.userId, 10_000);
    await useMessages(dxb.userId, 10_000);
    const resetAtMs = (await deps.allowanceStatus.status(ny.userId)).resetAtMs;
    const day = (tz: string) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).formatToParts(new Date(resetAtMs)); return `${p.find((x) => x.type === 'day')!.value} ${p.find((x) => x.type === 'month')!.value}`; };
    const msg = async (r: { token: string; clientId: string }) => ((await (await post(r.token, r.clientId, exportOf(5))).json()) as { message: string }).message;
    expect(await msg(ny)).toContain(`Resets ${day('America/New_York')}.`);
    expect(await msg(dxb)).toContain(`Resets ${day('Asia/Dubai')}.`);
  });
});

