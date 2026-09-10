import { describe, it, expect, vi } from 'vitest';
import { BillingService } from './billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../../adapters/billing/stub-stripe.js';
import { VatPolicy } from './vat.js';
import { InMemoryInvoiceTaxRepository } from '../../adapters/billing/in-memory-invoice-tax-repository.js';
import type { InvoiceTaxRepository } from '../../ports/invoice-tax-repository.js';

const NOW = Date.parse('2026-07-09T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function make() {
  const subs = new InMemorySubscriptionRepository();
  const trials = new InMemoryTrialGrantRepository();
  const events = new InMemoryWebhookEventRepository();
  const stripe = new StubStripeGateway('whsec_test');
  const billing = new BillingService(subs, trials, events, stripe, 7);
  return { subs, trials, events, billing, stripe };
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

describe('[BILLING-PERIOD] current_period_start — the spend-cap bucket anchor', () => {
  const START = Date.parse('2026-08-14T00:00:00Z');
  const END = Date.parse('2026-09-14T00:00:00Z');

  it('stores current_period_start from the activation webhook and exposes it as periodStart', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1', currentPeriodStart: START, currentPeriodEnd: END }), 'whsec_test');
    expect((await billing.entitlement('u', NOW)).periodStart).toBe(START);
  });

  it('a plan change starts a NEW bucket (new start) without losing the old — old start is not restored', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1', currentPeriodStart: START, currentPeriodEnd: END }), 'whsec_test');
    // Rep switches monthly → annual: Stripe issues a new period via a renewal invoice.
    const newStart = END;
    const newEnd = END + 365 * DAY;
    await billing.handleWebhook(evt({ id: 'e2', type: 'invoice.payment_succeeded', customerId: 'cus_1', currentPeriodStart: newStart, currentPeriodEnd: newEnd }), 'whsec_test');
    const ent = await billing.entitlement('u', NOW);
    expect(ent.periodStart).toBe(newStart); // the anchor moved forward → the new bucket starts clean
    expect(ent.status).toBe('active');
  });

  // NEGATIVE: never invent a start. A trial has none; an event without one leaves it null.
  it('leaves periodStart null for a trialing account and when the webhook carries none', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    expect((await billing.entitlement('u', NOW)).periodStart).toBeNull(); // trialing → no paid period
    await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1', currentPeriodEnd: END }), 'whsec_test');
    expect((await billing.entitlement('u', NOW)).periodStart).toBeNull(); // end present, start absent → not invented
  });

  it('a replayed webhook does not shift the anchor (idempotent)', async () => {
    const { billing } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    const payload = evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1', currentPeriodStart: START, currentPeriodEnd: END });
    await billing.handleWebhook(payload, 'whsec_test');
    // A replay of the SAME event id (even if it somehow carried a different start) must be a no-op.
    await billing.handleWebhook(evt({ id: 'e1', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_1', currentPeriodStart: START + 999 * DAY, currentPeriodEnd: END }), 'whsec_test');
    expect((await billing.entitlement('u', NOW)).periodStart).toBe(START); // unchanged
  });
});

describe('[INVOICE-DATA] the app supplies customer name + traceable metadata', () => {
  it('checkout creates a customer carrying the name (and stores it + the customer id)', async () => {
    const { billing, subs, stripe } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.checkout('u', 'rep@x.com', 'monthly', { name: 'Ahmed Kareem', company: 'Kareem Realty' });
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.customers[0]).toMatchObject({ userId: 'u', details: { name: 'Ahmed Kareem', company: 'Kareem Realty' } });
    const s = await subs.get('u');
    expect(s?.stripeCustomerId).toBe('cus_test_u'); // stored before the webhook, so a sync can target it
    expect(s?.billingName).toBe('Ahmed Kareem');
  });

  it('a name change in Settings syncs to the Stripe customer', async () => {
    const { billing, stripe } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.checkout('u', 'rep@x.com', 'monthly', { name: 'Ahmed' }); // establishes the customer
    await billing.setBillingName('u', { name: 'Ahmed Al Habtoor', company: 'Al Habtoor Group' });
    expect(stripe.updates.at(-1)).toEqual({ customerId: 'cus_test_u', details: { name: 'Ahmed Al Habtoor', company: 'Al Habtoor Group' } });
  });

  it('setting a name before any customer exists stores it but does not call Stripe (checkout carries it)', async () => {
    const { billing, subs, stripe } = make();
    await billing.onSignup('u', 'rep@x.com', NOW);
    await billing.setBillingName('u', { name: 'Ahmed' });
    expect(stripe.updates).toHaveLength(0); // no customer yet → nothing to sync
    expect((await subs.get('u'))?.billingName).toBe('Ahmed');
  });
});

describe('[VAT-READY] VAT off by default; on, date-driven; the boundary is immutable', () => {
  const REG = Date.parse('2026-11-01T00:00:00Z'); // registration date
  const beforeReg = Date.parse('2026-10-15T00:00:00Z');
  const afterReg = Date.parse('2026-11-15T00:00:00Z');

  function makeVat(opts: { registered: boolean; from?: number }, invoiceTax: InvoiceTaxRepository = new InMemoryInvoiceTaxRepository()) {
    const subs = new InMemorySubscriptionRepository();
    const stripe = new StubStripeGateway('whsec_test');
    const vat = new VatPolicy({ registered: opts.registered, trn: opts.registered ? '100xxxxxxxxxxxx' : null, rate: 0.05, registeredFromMs: opts.from ?? null });
    const billing = new BillingService(subs, new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), stripe, 7, undefined, vat, invoiceTax);
    return { billing, subs, stripe, invoiceTax };
  }
  const paidInvoice = (o: { id: string; total: number; country: string; at: number; customerId: string; eventId: string }) =>
    evt({ id: o.eventId, type: 'invoice.payment_succeeded', customerId: o.customerId, invoiceId: o.id, invoiceTotalFils: o.total, invoiceCountry: o.country, invoiceIssuedAtMs: o.at });

  // [VAT-INVOICE] customer TRN collection is gated on registration.
  it('collects the customer TRN at checkout ONLY when VAT is registered', async () => {
    const off = makeVat({ registered: false });
    await off.billing.onSignup('u', 'r@x.com', NOW);
    await off.billing.checkout('u', 'r@x.com', 'monthly');
    expect(off.stripe.taxIdCollected.at(-1)).toBe(false);

    const on = makeVat({ registered: true, from: REG });
    await on.billing.onSignup('u', 'r@x.com', NOW);
    await on.billing.checkout('u', 'r@x.com', 'monthly');
    expect(on.stripe.taxIdCollected.at(-1)).toBe(true);
  });

  it('records a UAE invoice after registration as an inclusive tax invoice (284.76 + 14.24)', async () => {
    const { billing } = makeVat({ registered: true, from: REG });
    await billing.onSignup('u', 'r@x.com', NOW);
    await billing.checkout('u', 'r@x.com', 'monthly'); // establishes customer cus_test_u
    await billing.handleWebhook(paidInvoice({ id: 'in_1', total: 29900, country: 'AE', at: afterReg, customerId: 'cus_test_u', eventId: 'e_inv1' }), 'whsec_test');
    const rec = await billing.invoiceTaxRecord('in_1');
    expect(rec).toMatchObject({ taxInvoice: true, zeroRated: false, netFils: 28476, vatFils: 1424, trn: '100xxxxxxxxxxxx' });
  });

  // [PROMO-CODES] A discounted invoice (Stripe applied a promotion code) records the tax treatment
  // decomposed from the DISCOUNTED total — the webhook state reflects the discounted amount, not the list.
  it('records a DISCOUNTED UAE invoice with VAT decomposed from the discounted total', async () => {
    const { billing } = makeVat({ registered: true, from: REG });
    await billing.onSignup('u', 'r@x.com', NOW);
    await billing.checkout('u', 'r@x.com', 'monthly');
    // 44%-off forever coupon → Stripe sends total 16744 (post-discount).
    await billing.handleWebhook(paidInvoice({ id: 'in_disc', total: 16744, country: 'AE', at: afterReg, customerId: 'cus_test_u', eventId: 'e_disc' }), 'whsec_test');
    const rec = await billing.invoiceTaxRecord('in_disc');
    expect(rec).toMatchObject({ taxInvoice: true, zeroRated: false, totalFils: 16744, netFils: 15947, vatFils: 797 });
  });

  // [VAT-BOUNDARY] the most important tests — they protect a tax record.
  it('an invoice dated BEFORE the registration date is a non-VAT invoice, even with VAT on', async () => {
    const { billing } = makeVat({ registered: true, from: REG });
    await billing.onSignup('u', 'r@x.com', NOW);
    await billing.checkout('u', 'r@x.com', 'monthly');
    await billing.handleWebhook(paidInvoice({ id: 'in_old', total: 29900, country: 'AE', at: beforeReg, customerId: 'cus_test_u', eventId: 'e_old' }), 'whsec_test');
    expect(await billing.invoiceTaxRecord('in_old')).toMatchObject({ taxInvoice: false, vatFils: 0, netFils: 29900 });
  });

  it('an invoice on the boundary date itself is a tax invoice', async () => {
    const { billing } = makeVat({ registered: true, from: REG });
    await billing.onSignup('u', 'r@x.com', NOW);
    await billing.checkout('u', 'r@x.com', 'monthly');
    await billing.handleWebhook(paidInvoice({ id: 'in_b', total: 29900, country: 'AE', at: REG, customerId: 'cus_test_u', eventId: 'e_b' }), 'whsec_test');
    expect((await billing.invoiceTaxRecord('in_b'))?.taxInvoice).toBe(true);
  });

  it('flipping VAT OFF does NOT strip VAT from an invoice issued while it was on (frozen record)', async () => {
    const store = new InMemoryInvoiceTaxRepository();
    const on = makeVat({ registered: true, from: REG }, store);
    await on.billing.onSignup('u', 'r@x.com', NOW);
    await on.billing.checkout('u', 'r@x.com', 'monthly');
    await on.billing.handleWebhook(paidInvoice({ id: 'in_1', total: 29900, country: 'AE', at: afterReg, customerId: 'cus_test_u', eventId: 'e1' }), 'whsec_test');
    // Config flips off (a new process/config), SAME durable store.
    const off = makeVat({ registered: false }, store);
    expect((await off.billing.invoiceTaxRecord('in_1'))?.taxInvoice).toBe(true); // unchanged — never stripped
    expect((await off.billing.invoiceTaxRecord('in_1'))?.vatFils).toBe(1424);
  });

  it('a re-delivered webhook never rewrites a frozen record (config change cannot mutate it)', async () => {
    const { billing } = makeVat({ registered: true, from: REG });
    await billing.onSignup('u', 'r@x.com', NOW);
    await billing.checkout('u', 'r@x.com', 'monthly');
    await billing.handleWebhook(paidInvoice({ id: 'in_1', total: 29900, country: 'AE', at: afterReg, customerId: 'cus_test_u', eventId: 'e1' }), 'whsec_test');
    // A different event id (so idempotency doesn't short-circuit) re-delivering the same invoice with a
    // different country must NOT change the frozen treatment.
    await billing.handleWebhook(paidInvoice({ id: 'in_1', total: 29900, country: 'GB', at: afterReg, customerId: 'cus_test_u', eventId: 'e2' }), 'whsec_test');
    expect((await billing.invoiceTaxRecord('in_1'))?.zeroRated).toBe(false); // still the original UAE treatment
    expect((await billing.invoiceTaxRecord('in_1'))?.vatFils).toBe(1424);
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
