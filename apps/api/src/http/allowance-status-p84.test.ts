import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P84-5 / P84-8 · owner, 22 Nov] The status the meter, banner and tour read: a trial's own figures (5,000 messages,
 * flagged as the trial, with the plan's 10,000 named for "Subscribe for 10,000 messages a month"), and the rep's own
 * time zone so "Resets <date>" is their day.
 */
let server: Server; let base: string; let deps: TestDeps;
beforeAll(async () => { deps = buildInMemoryDeps(); server = createApiServer(deps); await listenForTest(server); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function rep(email: string, timezone: string, subscribe: boolean) {
  const s = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', timezone }) })).json()) as { token: string; user: { id: string } };
  if (subscribe) await fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 'whsec_test', 'content-type': 'application/json' }, body: JSON.stringify({ id: `evt_sub_${s.user.id}`, type: 'checkout.session.completed', userId: s.user.id }) });
  return (await (await fetch(`${base}/allowance/status`, { headers: { authorization: `Bearer ${s.token}` } })).json()) as Record<string, unknown>;
}

describe('[P84] /allowance/status', () => {
  it('a trial: 5,000 messages, trial: true, and the plan\'s 10,000 named for subscribing', async () => {
    const s = await rep('st-trial@x.io', 'Asia/Dubai', false);
    expect(s).toMatchObject({ messagesAllowance: 5000, messagesLeft: 5000, trial: true, planMessages: 10_000, timeZone: 'Asia/Dubai' });
  });
  it('a subscriber: 10,000, trial: false, in their own time zone', async () => {
    const s = await rep('st-sub@x.io', 'America/New_York', true);
    expect(s).toMatchObject({ messagesAllowance: 10_000, trial: false, planMessages: 10_000, timeZone: 'America/New_York' });
  });
  it('NEGATIVE: still no money figure or percentage leaves the server outside the purchase options', async () => {
    const s = await rep('st-none@x.io', 'Asia/Dubai', false);
    expect(Object.keys(s).filter((k) => /aed|percent|cost|spend/i.test(k))).toEqual([]);
  });
});
