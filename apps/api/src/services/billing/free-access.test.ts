import { describe, it, expect } from 'vitest';
import { BillingService } from './billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../../adapters/billing/stub-stripe.js';
import { periodKeyFrom } from '../spend/period.js';
import { allowanceWindow } from '../spend/ai-period.js';
import { canRunAi, billingGateDecision } from './billing-access.js';

/**
 * [P72-2 · owner] Admin "Give free access". The owner's rules:
 *  - it lasts until revoked; if the person later subscribes through Stripe, Stripe takes over as normal;
 *  - the account is paid (entitled, AI runs) with no Stripe subscription behind it;
 *  - the same spend cap and monthly allowance apply, the month starting on the day access was given;
 *  - no trial, failed-payment or deletion job ever acts on a free-access account.
 */
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 17, 9, 0, 0); // 17 Nov 2026

function svc(now: () => number = () => T0) {
  const subs = new InMemorySubscriptionRepository();
  const billing = new BillingService(subs, new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 14, undefined, undefined, undefined, now);
  return { subs, billing };
}

describe('[P72-2] free access makes the account paid', () => {
  it('an expired trial becomes active and entitled, AI runs, the request gate allows everything', async () => {
    const { subs, billing } = svc();
    await subs.create('u1', T0 - DAY); // trial ended yesterday
    expect((await billing.entitlement('u1', T0)).entitled).toBe(false);
    await billing.grantFreeAccess('u1', 'wabil@tovira.io');
    const e = await billing.entitlement('u1', T0);
    expect(e).toMatchObject({ entitled: true, status: 'active', billingState: 'active', freeAccess: true, renewsAt: null, hostedInvoiceUrl: null });
    expect(canRunAi(e)).toBe(true);
    expect(billingGateDecision(e.billingState, 'POST', '/recall')).toBe('allow');
  });
  it('an account with no subscription row at all can be given it', async () => {
    const { billing } = svc();
    await billing.grantFreeAccess('u2', 'wabil@tovira.io');
    expect(await billing.entitlement('u2', T0)).toMatchObject({ entitled: true, status: 'active', freeAccess: true });
  });
  it('it lasts until revoked: still active a year later', async () => {
    const { subs, billing } = svc();
    await subs.create('u1', T0 - DAY);
    await billing.grantFreeAccess('u1', 'wabil@tovira.io');
    expect((await billing.entitlement('u1', T0 + 400 * DAY)).entitled).toBe(true);
  });
  it('NEGATIVE: revoked, the account is back to exactly what it was (an expired trial is not entitled)', async () => {
    const { subs, billing } = svc();
    await subs.create('u1', T0 - DAY);
    await billing.grantFreeAccess('u1', 'wabil@tovira.io');
    await billing.revokeFreeAccess('u1');
    const e = await billing.entitlement('u1', T0);
    expect(e).toMatchObject({ entitled: false, status: 'trial_expired' });
    expect(e.freeAccess).toBeUndefined();
  });
  it('NEGATIVE: it also lifts a suspended or ended account, and revoking puts that state back', async () => {
    const { subs, billing } = svc();
    await subs.create('u1', T0 - 60 * DAY);
    await subs.update('u1', { status: 'active', billingState: 'suspended', stripeSubscriptionId: 'sub_1' });
    await billing.grantFreeAccess('u1', 'wabil@tovira.io');
    expect(await billing.entitlement('u1', T0)).toMatchObject({ entitled: true, status: 'active', billingState: 'active', freeAccess: true });
    await billing.revokeFreeAccess('u1');
    expect(await billing.entitlement('u1', T0)).toMatchObject({ entitled: false, status: 'suspended' });
  });
});

describe('[P72-2] Stripe takes over when the person subscribes', () => {
  it('a paid, healthy Stripe subscription is shown as itself (renewal date, period), not as free access', async () => {
    const { subs, billing } = svc();
    await subs.create('u1', T0 - DAY);
    await billing.grantFreeAccess('u1', 'wabil@tovira.io');
    await subs.update('u1', { status: 'active', billingState: 'active', stripeSubscriptionId: 'sub_1', currentPeriodStart: T0, currentPeriodEnd: T0 + 30 * DAY });
    const e = await billing.entitlement('u1', T0 + DAY);
    expect(e).toMatchObject({ entitled: true, status: 'active', renewsAt: T0 + 30 * DAY, periodStart: T0 });
    expect(e.freeAccess).toBeUndefined();
  });
});

describe('[P72-2] the same spend cap and monthly allowance, the month starting on the day it was given', () => {
  it('the period starts on the grant day and moves on each month (never one period forever)', async () => {
    let now = T0;
    const { subs, billing } = svc(() => now);
    await subs.create('u1', T0 - DAY);
    await billing.grantFreeAccess('u1', 'wabil@tovira.io');
    const key = async (at: number) => { const e = await billing.entitlement('u1', at); return periodKeyFrom({ status: e.status, trialEndsAt: e.trialEndsAt, renewsAt: e.renewsAt, periodStart: e.periodStart }, at); };
    const k0 = await key(T0 + DAY);
    expect(k0).toEqual({ key: `p:${T0 - 9 * 60 * 60 * 1000}`, fallback: false }); // 17 Nov 00:00 UTC
    expect((await key(T0 + 20 * DAY)).key).toBe(k0.key); // 7 Dec: same month
    const k1 = await key(Date.UTC(2026, 11, 17, 1)); // 17 Dec: the next month
    expect(k1.key).toBe(`p:${Date.UTC(2026, 11, 17)}`);
    // the monthly allowance window agrees: anchored on the 17th
    const e = await billing.entitlement('u1', T0 + DAY);
    const w = allowanceWindow({ status: e.status, trialEndsAt: e.trialEndsAt, renewsAt: e.renewsAt, periodStart: e.periodStart }, T0 + DAY);
    expect(w).toMatchObject({ startMs: Date.UTC(2026, 10, 17), endMs: Date.UTC(2026, 11, 17), anchorDay: 17 });
    now = T0;
  });
});

describe('[P72-2] no billing job acts on a free-access account', () => {
  it('NEGATIVE: not in the trial-email list, the failed-payment list or the ended (90-day deletion) list', async () => {
    const { subs, billing } = svc();
    await subs.create('trial', T0 + 3 * DAY);
    await subs.create('dunning', T0 - DAY);
    await subs.update('dunning', { status: 'active', billingState: 'payment_failed' });
    await subs.create('ended', T0 - DAY);
    await subs.update('ended', { status: 'canceled', billingState: 'ended', endedAt: T0 - DAY });
    for (const u of ['trial', 'dunning', 'ended']) await billing.grantFreeAccess(u, 'wabil@tovira.io');
    expect(await subs.listTrialing()).toEqual([]);
    expect(await subs.listInDunning()).toEqual([]);
    expect(await subs.listEnded()).toEqual([]);
    for (const u of ['trial', 'dunning', 'ended']) await billing.revokeFreeAccess(u);
    expect((await subs.listTrialing()).map((s) => s.userId)).toEqual(['trial']);
    expect((await subs.listInDunning()).map((s) => s.userId)).toEqual(['dunning']);
    expect((await subs.listEnded()).map((s) => s.userId)).toEqual(['ended']);
  });
});

describe('[P72-2] the list of free-access accounts', () => {
  it('lists who has it, since when and who gave it; giving twice keeps the first date', async () => {
    let now = T0;
    const { subs, billing } = svc(() => now);
    await subs.create('u1', T0 - DAY);
    await billing.grantFreeAccess('u1', 'wabil@tovira.io');
    now = T0 + DAY;
    await billing.grantFreeAccess('u1', 'other@tovira.io');
    expect(await billing.listFreeAccess()).toEqual([{ userId: 'u1', since: T0, by: 'wabil@tovira.io' }]);
    await billing.revokeFreeAccess('u1');
    expect(await billing.listFreeAccess()).toEqual([]);
  });
});
