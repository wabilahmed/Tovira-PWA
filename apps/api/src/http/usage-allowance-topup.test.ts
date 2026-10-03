import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [USAGE-ALLOWANCE · D6/D10/D12] Top-ups: the meter status, the checkout (trial refused, subscribed
 * allowed), and the webhook crediting the allowance exactly once on a replayed event.
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
/** Drive the rep to subscribed via a (stub) subscription webhook. */
async function subscribe(userId: string): Promise<void> {
  await fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 'whsec_test', 'content-type': 'application/json' }, body: JSON.stringify({ id: `evt_sub_${userId}`, type: 'checkout.session.completed', userId }) });
}
async function topUpEvent(id: string, userId: string, optionId: string): Promise<number> {
  const r = await fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 'whsec_test', 'content-type': 'application/json' }, body: JSON.stringify({ id, type: 'checkout.session.completed', mode: 'payment', userId, topUpOptionId: optionId }) });
  return r.status;
}

describe('[USAGE-ALLOWANCE · D3/D10] the meter status', () => {
  it('a trial rep sees a percentage, no top-up option, and a reset date', async () => {
    const { token } = await signup('meter-trial@example.com');
    const s = (await (await fetch(`${base}/allowance/status`, { headers: H(token) })).json()) as { percentUsed: number; exhausted: boolean; canTopUp: boolean; options: unknown[]; resetAt: string };
    expect(s.percentUsed).toBe(0);
    expect(s.exhausted).toBe(false);
    expect(s.canTopUp).toBe(false); // D10 — no top-ups in trial
    expect(s.options).toEqual([]);
    expect(typeof s.resetAt).toBe('string');
  });

  it('a subscribed rep sees the five top-up options', async () => {
    const { token, userId } = await signup('meter-sub@example.com');
    await subscribe(userId);
    const s = (await (await fetch(`${base}/allowance/status`, { headers: H(token) })).json()) as { canTopUp: boolean; options: unknown[] };
    expect(s.canTopUp).toBe(true);
    expect(s.options).toHaveLength(5);
  });

  it('shows 100% + exhausted once the allowance is used up', async () => {
    const { token, userId } = await signup('meter-exhausted@example.com');
    await deps.exhaustAllowance(userId);
    const s = (await (await fetch(`${base}/allowance/status`, { headers: H(token) })).json()) as { percentUsed: number; exhausted: boolean };
    expect(s.exhausted).toBe(true);
    expect(s.percentUsed).toBe(100);
  });
});

describe('[USAGE-ALLOWANCE · D6/D10] top-up checkout', () => {
  it('a trial rep is refused (403) — no card on file', async () => {
    const { token } = await signup('topup-trial@example.com');
    const res = await fetch(`${base}/billing/top-up`, { method: 'POST', headers: H(token), body: JSON.stringify({ optionId: 'topup_25' }) });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe('top_up_requires_subscription');
  });

  it('a subscribed rep gets a checkout url for the chosen option', async () => {
    const { token, userId } = await signup('topup-sub@example.com');
    await subscribe(userId);
    const res = await fetch(`${base}/billing/top-up`, { method: 'POST', headers: H(token), body: JSON.stringify({ optionId: 'topup_50' }) });
    expect(res.status).toBe(200);
    expect((await res.json() as { url: string }).url).toContain('topup_50');
  });

  it('rejects an unknown option', async () => {
    const { token, userId } = await signup('topup-bad@example.com');
    await subscribe(userId);
    const res = await fetch(`${base}/billing/top-up`, { method: 'POST', headers: H(token), body: JSON.stringify({ optionId: 'topup_999' }) });
    expect(res.status).toBe(400);
  });
});

describe('[USAGE-ALLOWANCE · D12] the top-up webhook credits exactly once', () => {
  it('a replayed webhook event credits the allowance only once', async () => {
    const { userId } = await signup('topup-webhook@example.com');
    // +25% = AED 10 credited.
    expect(await topUpEvent('evt_topup_once', userId, 'topup_25')).toBe(200);
    const after = (await deps.allowanceStatus.status(userId)).topupAed;
    expect(after).toBe(10);
    // Replay the SAME event id — must NOT credit again (D12).
    expect(await topUpEvent('evt_topup_once', userId, 'topup_25')).toBe(200);
    expect((await deps.allowanceStatus.status(userId)).topupAed).toBe(10);
  });
});
