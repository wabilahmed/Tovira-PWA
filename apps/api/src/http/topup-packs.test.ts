import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { TOP_UP_PACKS, TOP_UP_OPTIONS, topUpCreditAed, DEFAULT_MONTHLY_AI_ALLOWANCE_AED } from '../config.js';

/**
 * [P37 · owner, 20 Oct] Top-up packs: "AED 1 buys 1% of your monthly allowance". Exactly three — AED 50 (+50%),
 * AED 100 (+100%), AED 150 (+150%) — kept in config as {price_aed, percent}; the credit is percent × the monthly
 * allowance at the time of purchase. The AED 65 / 85 / 120 packs are gone: refused at checkout. A checkout
 * already opened under a retired pack id still credits what it was sold for (no paid credit is lost), and
 * top-ups already credited are untouched.
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
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', consent: true }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
async function subscribe(userId: string): Promise<void> {
  await fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 'whsec_test', 'content-type': 'application/json' }, body: JSON.stringify({ id: `evt_sub_${userId}`, type: 'checkout.session.completed', userId }) });
}
const credit = (id: string, userId: string, optionId: string) => fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 'whsec_test', 'content-type': 'application/json' }, body: JSON.stringify({ id, type: 'checkout.session.completed', mode: 'payment', userId, topUpOptionId: optionId }) });

describe('[P37] the top-up packs', () => {
  it('config: exactly three packs, {price_aed, percent} = 50/50, 100/100, 150/150', () => {
    expect(TOP_UP_PACKS.map((p) => [p.priceAed, p.percent])).toEqual([[50, 50], [100, 100], [150, 150]]);
    expect(TOP_UP_OPTIONS.map((o) => [o.priceAed, o.label])).toEqual([[50, '+50%'], [100, '+100%'], [150, '+150%']]);
  });

  it('each credits percent × the monthly allowance at the time of purchase', () => {
    for (const p of TOP_UP_OPTIONS) {
      const pct = TOP_UP_PACKS.find((x) => x.id === p.id)!.percent;
      expect(topUpCreditAed(p.id, 60)).toBe(60 * pct / 100);
      expect(topUpCreditAed(p.id, 80)).toBe(80 * pct / 100); // the rule holds if the allowance changes
    }
  });

  it('a subscriber is offered exactly the three packs', async () => {
    const { token, userId } = await signup('packs-offer@example.com');
    await subscribe(userId);
    const s = (await (await fetch(`${base}/allowance/status`, { headers: H(token) })).json()) as { options: Array<{ id: string; label: string; priceAed: number }> };
    expect(s.options.map((o) => [o.priceAed, o.label])).toEqual([[50, '+50%'], [100, '+100%'], [150, '+150%']]);
  });

  it('the webhook credits +150% = 1.5 × the allowance', async () => {
    const { userId } = await signup('packs-150@example.com');
    await subscribe(userId);
    expect((await credit('evt_pack150', userId, 'topup_150')).status).toBe(200);
    expect((await deps.allowanceStatus.status(userId)).topupAed).toBe(1.5 * DEFAULT_MONTHLY_AI_ALLOWANCE_AED);
  });

  it('the retired AED 65 / 85 / 120 packs are refused at checkout; only 50 / 100 / 150 can be charged', async () => {
    const { token, userId } = await signup('packs-retired@example.com');
    await subscribe(userId);
    for (const retired of ['topup_15', 'topup_25', 'topup_75']) {
      const res = await fetch(`${base}/billing/top-up`, { method: 'POST', headers: H(token), body: JSON.stringify({ optionId: retired }) });
      expect([retired, res.status]).toEqual([retired, 400]);
    }
    const charged: number[] = [];
    for (const o of TOP_UP_OPTIONS) {
      const res = await fetch(`${base}/billing/top-up`, { method: 'POST', headers: H(token), body: JSON.stringify({ optionId: o.id }) });
      expect(res.status).toBe(200);
      charged.push(o.priceAed);
    }
    expect(charged.sort((a, b) => a - b)).toEqual([50, 100, 150]);
    expect(charged.some((p) => [65, 85, 120].includes(p))).toBe(false);
  });

  it('a past top-up keeps exactly what it credited; a retired pack bought before the change still credits its old amount', async () => {
    const { userId } = await signup('packs-past@example.com');
    await subscribe(userId);
    expect((await credit('evt_old_25', userId, 'topup_25')).status).toBe(200); // a +25% bought before the change
    const before = (await deps.allowanceStatus.status(userId)).topupAed;
    expect(before).toBe(0.25 * DEFAULT_MONTHLY_AI_ALLOWANCE_AED);
    expect((await credit('evt_new_50', userId, 'topup_50')).status).toBe(200);
    expect((await deps.allowanceStatus.status(userId)).topupAed).toBe(before + 0.5 * DEFAULT_MONTHLY_AI_ALLOWANCE_AED);
  });
});
