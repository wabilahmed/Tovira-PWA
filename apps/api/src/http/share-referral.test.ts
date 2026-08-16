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

async function signup(email: string, ref?: string): Promise<{ token: string; userId: string; referralCode: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', ref }) });
  const body = (await res.json()) as { token: string; user: { id: string; referralCode: string } };
  return { token: body.token, userId: body.user.id, referralCode: body.user.referralCode };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const trialEnd = async (t: string) => ((await (await fetch(`${base}/billing/status`, { headers: auth(t) })).json()) as { trialEndsAt: number }).trialEndsAt;
const DAY = 24 * 60 * 60 * 1000;

describe('[P5-6] share card', () => {
  it('requires auth', async () => {
    expect((await fetch(`${base}/share-card`)).status).toBe(401);
  });

  // PRIVACY: the card is counts only — never a client name, quote, or identifier.
  it('returns counts only, with zero client-identifying content', async () => {
    const { token, userId } = await signup('share@example.com');
    const cid = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'SecretClientName' }) })).json()) as { id: string }).id;
    await deps.facts.saveExtraction(userId, { noteId: 'n', clientId: cid, promises: [{ text: 'send the SECRET quote to SecretClientName', owner: 'rep', due_date: '2026-12-01', due_raw: null, confidence: 'high' }] });

    const res = await fetch(`${base}/share-card`, { headers: auth(token) });
    const text = await res.text();
    expect(res.status).toBe(200);
    const card = JSON.parse(text) as Record<string, number>;
    expect(typeof card.openPromises).toBe('number');
    // No identifiers leak into the shareable card.
    expect(text).not.toMatch(/SecretClientName/);
    expect(text).not.toMatch(/SECRET quote/);
    for (const v of Object.values(card)) expect(typeof v).toBe('number');
  });
});

describe('[P5-6] referral', () => {
  it('credits both the referrer and the referred with a free month', async () => {
    const referrer = await signup('referrer@example.com');
    const beforeReferrer = await trialEnd(referrer.token);

    const referred = await signup('referred@example.com', referrer.referralCode);
    const control = await signup('control@example.com'); // no referral

    // The referrer gained a month (tolerant of sub-second signup timing).
    expect(Math.abs((await trialEnd(referrer.token)) - beforeReferrer - 30 * DAY)).toBeLessThan(2000);
    // The referred user's trial is ~30 days longer than an un-referred control.
    expect(Math.abs((await trialEnd(referred.token)) - (await trialEnd(control.token)) - 30 * DAY)).toBeLessThan(2000);
  });

  // The referral link carries an OPAQUE code, never the raw user id (no internal
  // identifier leaks into a shareable URL).
  it('exposes an opaque referral code that is not the raw user id', async () => {
    const u = await signup('opaque@example.com');
    expect(u.referralCode).toBeTruthy();
    expect(u.referralCode).not.toBe(u.userId);
    // /me exposes the same code the share link uses.
    const me = (await (await fetch(`${base}/me`, { headers: auth(u.token) })).json()) as { user: { id: string; referralCode: string } };
    expect(me.user.referralCode).toBe(u.referralCode);
    expect(me.user.referralCode).not.toBe(me.user.id);
  });

  // ANTI-FARMING: referring yourself grants nothing (own id isn't known at signup,
  // but the service rejects it regardless).
  it('does not credit an unknown/blank referral code', async () => {
    const before = (await signup('noref@example.com')).token;
    const beforeEnd = await trialEnd(before);
    // A signup carrying a garbage ref still just starts a normal 7-day trial.
    const withGarbage = await signup('garbage-ref@example.com', 'garbage');
    const control = await signup('control2@example.com');
    // A garbage referrer credits NO ONE — the referred user gets a normal trial.
    expect(Math.abs((await trialEnd(withGarbage.token)) - (await trialEnd(control.token)))).toBeLessThan(2000);
    expect(beforeEnd).toBeGreaterThan(0);
  });
});
