import { describe, it, expect } from 'vitest';
import { BillingService } from './billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../../adapters/billing/stub-stripe.js';

const NOW = Date.parse('2026-07-09T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function make() {
  const subs = new InMemorySubscriptionRepository();
  const trials = new InMemoryTrialGrantRepository();
  const events = new InMemoryWebhookEventRepository();
  const stripe = new StubStripeGateway('whsec_test');
  const billing = new BillingService(subs, trials, events, stripe, 7);
  return { subs, trials, events, billing };
}
const evt = (o: object) => JSON.stringify(o);

describe('[P5-1] free trial', () => {
  it('grants a 7-day trial with full access at signup', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    const e = await billing.entitlement('u', NOW);
    expect(e.entitled).toBe(true);
    expect(e.status).toBe('trialing');
    expect(e.trialEndsAt).toBe(NOW + 7 * DAY);
  });

  // NEGATIVE: day 8 unpaid → locked.
  it('locks access after the trial ends with no payment', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    const e = await billing.entitlement('u', NOW + 8 * DAY);
    expect(e.entitled).toBe(false);
    expect(e.status).toBe('trial_expired');
  });

  // NEGATIVE: deleting/recreating an account doesn't grant a fresh trial.
  it('does not grant a fresh trial for a re-used email (no trial farming)', async () => {
    const { billing } = make();
    await billing.onSignup('u1', 'rep@x.com', NOW);
    // "delete" u1, sign up again with the same email a week later.
    await billing.onSignup('u2', 'REP@x.com', NOW + 7 * DAY);
    const e = await billing.entitlement('u2', NOW + 8 * DAY);
    expect(e.entitled).toBe(false); // trial window is anchored to the first grant
  });
});

describe('[P5-2] billing via webhooks (source of truth)', () => {
  it('activates only on the webhook, not on a client success redirect', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.checkout('u', 'rep@x.com'); // client would be redirected here
    // No webhook yet → still just trialing, NOT active.
    expect((await billing.entitlement('u', NOW)).status).toBe('trialing');

    expect(await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1' }), 'whsec_test')).toBe(200);
    const after = await billing.entitlement('u', NOW + 30 * DAY); // even past trial, active
    expect(after.entitled).toBe(true);
    expect(after.status).toBe('active');
  });

  it('rejects an invalid webhook signature (400)', async () => {
    const { billing } = make();
    expect(await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u' }), 'wrong-sig')).toBe(400);
  });

  it('processes a replayed webhook idempotently', async () => {
    const { billing, subs } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    const payload = evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1' });
    await billing.handleWebhook(payload, 'whsec_test');
    await billing.handleWebhook(payload, 'whsec_test'); // replay
    expect((await subs.get('u'))!.status).toBe('active'); // no double-provision, still active
  });

  it('downgrades on cancellation and past-dues on a failed payment', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.handleWebhook(evt({ id: 'a', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1' }), 'whsec_test');
    await billing.handleWebhook(evt({ id: 'b', type: 'invoice.payment_failed', customerId: 'cus_1' }), 'whsec_test');
    expect((await billing.entitlement('u', NOW)).status).toBe('past_due');
    await billing.handleWebhook(evt({ id: 'c', type: 'customer.subscription.deleted', customerId: 'cus_1' }), 'whsec_test');
    expect((await billing.entitlement('u', NOW)).status).toBe('canceled');
  });
});
