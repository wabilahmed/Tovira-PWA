import { describe, it, expect, vi } from 'vitest';
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

describe('[P5-2] renewal date (from the webhook, source of truth)', () => {
  const RENEW = Date.parse('2026-09-14T00:00:00Z');
  it('stores current_period_end from the activation webhook and exposes it as renewsAt', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1', currentPeriodEnd: RENEW }), 'whsec_test');
    expect((await billing.entitlement('u', NOW)).renewsAt).toBe(RENEW);
  });

  it('advances renewsAt on a renewal invoice (the webhook is the source of truth)', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1', currentPeriodEnd: RENEW }), 'whsec_test');
    const next = RENEW + 30 * DAY;
    await billing.handleWebhook(evt({ id: 'e2', type: 'invoice.payment_succeeded', customerId: 'cus_1', currentPeriodEnd: next }), 'whsec_test');
    const ent = await billing.entitlement('u', NOW);
    expect(ent.status).toBe('active'); // a successful renewal keeps access
    expect(ent.renewsAt).toBe(next);
  });

  // NEGATIVE: no period end in the event → renewsAt stays null. Never guess a date.
  it('leaves renewsAt null when the webhook carries no period end', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1' }), 'whsec_test');
    expect((await billing.entitlement('u', NOW)).renewsAt).toBeNull();
  });
});

describe('[P5-1] activity-gated trial extension', () => {
  it('extends the trial by 7 days once when notes span 3+ distinct clients', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    const before = (await billing.entitlement('u', NOW)).trialEndsAt;
    expect(await billing.extendTrialForActivity('u', 3)).toBe(true);
    const after = (await billing.entitlement('u', NOW)).trialEndsAt;
    expect(after - before).toBe(7 * DAY);
  });

  it('cannot be earned twice (re-qualifying does nothing)', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    expect(await billing.extendTrialForActivity('u', 5)).toBe(true);
    expect(await billing.extendTrialForActivity('u', 5)).toBe(false); // already extended
  });

  it('does not extend for fewer than 3 distinct clients', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    expect(await billing.extendTrialForActivity('u', 2)).toBe(false);
  });

  it('does not extend a non-trial (paid/expired) account', async () => {
    const { billing, subs } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await subs.update('u', { status: 'active' });
    expect(await billing.extendTrialForActivity('u', 5)).toBe(false);
  });
});

// [P5-1-UI] The server owns eligibility for the +7-day incentive; the client
// only renders what the server reports. Four states: progress, earned, and two
// hidden cases (already extended is folded into earned + a client-side dismissal;
// converted-to-paid / expired → hidden).
describe('[P5-1-UI] trial-extension incentive (server-computed)', () => {
  it('reports progress toward the extension while trialing and below the threshold', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    const inc = await billing.extensionIncentive('u', 2, NOW);
    expect(inc.state).toBe('progress');
    expect(inc.distinctClients).toBe(2);
    expect(inc.needed).toBe(3);
    expect(inc.remaining).toBe(1);
    expect(inc.extensionDays).toBe(7);
  });

  it('reports "earned" with the NEW trial end once the extension has been applied', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    const before = (await billing.entitlement('u', NOW)).trialEndsAt;
    await billing.extendTrialForActivity('u', 3);
    const inc = await billing.extensionIncentive('u', 3, NOW);
    expect(inc.state).toBe('earned');
    expect(inc.remaining).toBe(0);
    expect(inc.trialEndsAt - before).toBe(7 * DAY); // the extended end, from the server
  });

  it('is hidden once the account has converted to paid', async () => {
    const { billing, subs } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await subs.update('u', { status: 'active' });
    expect((await billing.extensionIncentive('u', 5, NOW)).state).toBe('hidden');
  });

  it('is hidden once the trial has expired', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    const afterTrial = NOW + 8 * DAY;
    expect((await billing.extensionIncentive('u', 2, afterTrial)).state).toBe('hidden');
  });

  it('is hidden when there is no subscription at all', async () => {
    const { billing } = make();
    expect((await billing.extensionIncentive('nobody', 3, NOW)).state).toBe('hidden');
  });
});

describe('[EMAIL-HOOKS 1b] webhook lifecycle emails', () => {
  const RENEW = Date.parse('2026-09-14T00:00:00Z');
  function withHook(hook: { paymentFailed?: unknown; subscriptionConfirmed?: unknown; subscriptionCanceled?: unknown }) {
    const subs = new InMemorySubscriptionRepository();
    const billing = new BillingService(subs, new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 7, hook as never);
    return { subs, billing };
  }

  it('fires confirmed/failed/canceled, with the renewal date only when supplied', async () => {
    const hook = { paymentFailed: vi.fn(), subscriptionConfirmed: vi.fn(), subscriptionCanceled: vi.fn() };
    const { billing } = withHook(hook);
    await billing.onSignup('u', 'u@x.com', NOW);
    await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1', currentPeriodEnd: RENEW }), 'whsec_test');
    expect(hook.subscriptionConfirmed).toHaveBeenCalledWith('u', 'e1', RENEW);
    await billing.handleWebhook(evt({ id: 'e2', type: 'invoice.payment_failed', customerId: 'cus_1' }), 'whsec_test');
    expect(hook.paymentFailed).toHaveBeenCalledWith('u', 'e2');
    await billing.handleWebhook(evt({ id: 'e3', type: 'customer.subscription.deleted', customerId: 'cus_1' }), 'whsec_test');
    expect(hook.subscriptionCanceled).toHaveBeenCalledWith('u', 'e3');
  });

  it('a confirmation without a period end passes renewsAt null (never invented)', async () => {
    const hook = { paymentFailed: vi.fn(), subscriptionConfirmed: vi.fn(), subscriptionCanceled: vi.fn() };
    const { billing } = withHook(hook);
    await billing.onSignup('u', 'u@x.com', NOW);
    await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1' }), 'whsec_test');
    expect(hook.subscriptionConfirmed).toHaveBeenCalledWith('u', 'e1', null);
  });

  it('is idempotent per Stripe event id (a replayed webhook sends nothing twice)', async () => {
    const hook = { paymentFailed: vi.fn(), subscriptionConfirmed: vi.fn(), subscriptionCanceled: vi.fn() };
    const { billing } = withHook(hook);
    await billing.onSignup('u', 'u@x.com', NOW);
    const payload = evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1' });
    await billing.handleWebhook(payload, 'whsec_test');
    await billing.handleWebhook(payload, 'whsec_test'); // replay
    expect(hook.subscriptionConfirmed).toHaveBeenCalledTimes(1);
  });

  // [1d] a failing email never breaks the webhook — state still changes, still 200.
  it('isolates a failing lifecycle email from the webhook', async () => {
    const hook = { paymentFailed: vi.fn().mockRejectedValue(new Error('SES')), subscriptionConfirmed: vi.fn().mockRejectedValue(new Error('SES')), subscriptionCanceled: vi.fn() };
    const { subs, billing } = withHook(hook);
    await billing.onSignup('u', 'u@x.com', NOW);
    expect(await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1' }), 'whsec_test')).toBe(200);
    expect((await subs.get('u'))!.status).toBe('active'); // business action succeeded regardless
  });
});
