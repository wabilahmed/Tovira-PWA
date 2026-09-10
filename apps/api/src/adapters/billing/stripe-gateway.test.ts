import { describe, it, expect, vi } from 'vitest';
import { StripeGatewayImpl, type StripeLike } from './stripe-gateway.js';

const opts = { secretKey: 'sk_test_x', webhookSecret: 'whsec_x', priceId: 'price_1', successUrl: 'http://s', cancelUrl: 'http://c' };

describe('StripeGatewayImpl', () => {
  function fakeStripe(over: Partial<StripeLike> = {}) {
    const sessionCreate = vi.fn(async (_p: Record<string, unknown>) => ({ url: 'https://checkout.stripe.com/abc', id: 'cs_1' }));
    const customerCreate = vi.fn(async (_p: Record<string, unknown>) => ({ id: 'cus_new' }));
    const customerUpdate = vi.fn(async (_id: string, _p: Record<string, unknown>) => ({ id: 'cus_new' }));
    const stripe = {
      checkout: { sessions: { create: sessionCreate } },
      customers: { create: customerCreate, update: customerUpdate },
      webhooks: { constructEvent: () => ({}) },
      ...over,
    } as unknown as StripeLike;
    return { stripe, sessionCreate, customerCreate, customerUpdate };
  }

  it('creates a subscription checkout session tagged with the user id', async () => {
    const { stripe, sessionCreate } = fakeStripe();
    const g = new StripeGatewayImpl({ ...opts, stripe });
    const out = await g.createCheckoutSession('user-1', 'a@b.com');
    expect(out.url).toContain('checkout.stripe.com');
    expect(sessionCreate.mock.calls[0]![0].client_reference_id).toBe('user-1');
    expect(sessionCreate.mock.calls[0]![0].mode).toBe('subscription');
  });

  // INVOICE-DATA: the customer carries the name + the tovira user-id metadata; only that + email.
  it('creates a customer with the name and the user-id metadata, and nothing more', async () => {
    const { stripe, sessionCreate, customerCreate } = fakeStripe();
    const out = await new StripeGatewayImpl({ ...opts, stripe }).createCheckoutSession('user-1', 'a@b.com', 'monthly', { name: 'Ahmed Kareem', company: 'Kareem Realty' });
    const params = customerCreate.mock.calls[0]![0] as { email?: string; name?: string; metadata?: Record<string, string> };
    expect(params.email).toBe('a@b.com');
    expect(params.name).toBe('Ahmed Kareem');
    expect(params.metadata).toEqual({ tovira_user_id: 'user-1', company: 'Kareem Realty' });
    // No PII beyond email + name + our own metadata.
    expect(Object.keys(params).sort()).toEqual(['email', 'metadata', 'name']);
    // The session uses the created customer (not a bare customer_email), and reports its id.
    expect(sessionCreate.mock.calls[0]![0].customer).toBe('cus_new');
    expect(out.customerId).toBe('cus_new');
  });

  it('reuses an existing customer instead of creating a duplicate', async () => {
    const { stripe, customerCreate, sessionCreate } = fakeStripe();
    const out = await new StripeGatewayImpl({ ...opts, stripe }).createCheckoutSession('user-1', 'a@b.com', 'monthly', { existingCustomerId: 'cus_old' });
    expect(customerCreate).not.toHaveBeenCalled();
    expect(sessionCreate.mock.calls[0]![0].customer).toBe('cus_old');
    expect(out.customerId).toBe('cus_old');
  });

  it('updateCustomer syncs a name/company change to Stripe', async () => {
    const { stripe, customerUpdate } = fakeStripe();
    await new StripeGatewayImpl({ ...opts, stripe }).updateCustomer('cus_1', { name: 'New Name', company: 'NewCo' });
    expect(customerUpdate.mock.calls[0]![0]).toBe('cus_1');
    expect(customerUpdate.mock.calls[0]![1]).toEqual({ name: 'New Name', metadata: { company: 'NewCo' } });
  });

  // [VAT-INVOICE] tax-id (TRN) collection is enabled on the session only when asked.
  it('enables tax_id_collection AND requires a billing address only when collectTaxId is set', async () => {
    const on = fakeStripe();
    await new StripeGatewayImpl({ ...opts, stripe: on.stripe }).createCheckoutSession('u', 'a@b.com', 'monthly', { collectTaxId: true });
    expect(on.sessionCreate.mock.calls[0]![0].tax_id_collection).toEqual({ enabled: true });
    // The country decides UAE-taxed vs non-UAE zero-rated — it must be captured when VAT is on.
    expect(on.sessionCreate.mock.calls[0]![0].billing_address_collection).toBe('required');

    const off = fakeStripe();
    await new StripeGatewayImpl({ ...opts, stripe: off.stripe }).createCheckoutSession('u', 'a@b.com', 'monthly', { collectTaxId: false });
    expect(off.sessionCreate.mock.calls[0]![0].tax_id_collection).toBeUndefined();
    expect(off.sessionCreate.mock.calls[0]![0].billing_address_collection).toBeUndefined();
  });

  // [PROMO-CODES] Stripe-hosted Checkout accepts + enforces the promotion code; we enable the field
  // and forward NO code ourselves, so a bad/exhausted code can never block creating the session.
  it('enables promotion codes on the session and forwards no discount of its own', async () => {
    const { stripe, sessionCreate } = fakeStripe();
    const out = await new StripeGatewayImpl({ ...opts, stripe }).createCheckoutSession('u', 'a@b.com');
    const params = sessionCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.discounts).toBeUndefined(); // we never pass a code → creation can't be rejected for one
    expect(out.url).toContain('checkout.stripe.com'); // full-price checkout always succeeds
  });

  // [PROMO-CODES] A discount lands in the invoice TOTAL (post-discount); Stripe's subtotal is the list
  // price. We must read `total`, so VAT later decomposes from the discounted amount, not the list.
  it('reads the DISCOUNTED invoice total (not the pre-discount subtotal)', async () => {
    const stripe = {
      checkout: { sessions: { create: async () => ({ url: '', id: '' }) } },
      customers: { create: async () => ({ id: 'c' }), update: async () => ({ id: 'c' }) },
      // list 29900, a 44% off coupon → total 16744; subtotal stays at the list price.
      webhooks: { constructEvent: () => ({ id: 'evt_d', type: 'invoice.payment_succeeded', data: { object: { id: 'in_d', customer: 'cus_1', subtotal: 29900, total: 16744, created: 1_762_000_000, customer_address: { country: 'AE' } } } }) },
    } as unknown as StripeLike;
    const event = new StripeGatewayImpl({ ...opts, stripe }).constructEvent('{}', 'sig');
    expect(event!.invoiceTotalFils).toBe(16744); // the discounted total, not 29900
  });

  // [VAT] invoice.* events surface the id, total (fils), customer country, and supply date.
  it('extracts invoice fields (id, total, country, supply date) from an invoice event', async () => {
    const stripe = {
      checkout: { sessions: { create: async () => ({ url: '', id: '' }) } },
      customers: { create: async () => ({ id: 'c' }), update: async () => ({ id: 'c' }) },
      webhooks: { constructEvent: () => ({ id: 'evt_9', type: 'invoice.payment_succeeded', data: { object: { id: 'in_9', customer: 'cus_1', total: 29900, created: 1_762_000_000, customer_address: { country: 'AE' } } } }) },
    } as unknown as StripeLike;
    const event = new StripeGatewayImpl({ ...opts, stripe }).constructEvent('{}', 'sig');
    expect(event).toMatchObject({ invoiceId: 'in_9', invoiceTotalFils: 29900, invoiceCountry: 'AE', invoiceIssuedAtMs: 1_762_000_000_000 });
  });

  it('maps a verified webhook to our event shape', async () => {
    const stripe = {
      checkout: { sessions: { create: async () => ({ url: '', id: '' }) } },
      webhooks: { constructEvent: () => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: 'user-1', customer: 'cus_1', subscription: 'sub_1' } } }) },
    } as unknown as StripeLike;
    const event = new StripeGatewayImpl({ ...opts, stripe }).constructEvent('{}', 'sig');
    expect(event).toEqual({ id: 'evt_1', type: 'checkout.session.completed', userId: 'user-1', customerId: 'cus_1', subscriptionId: 'sub_1' });
  });

  // NEGATIVE: a forged/unsigned event fails verification → null (rejected).
  it('returns null when signature verification throws', async () => {
    const stripe = {
      checkout: { sessions: { create: async () => ({ url: '', id: '' }) } },
      webhooks: { constructEvent: () => { throw new Error('bad signature'); } },
    } as unknown as StripeLike;
    expect(new StripeGatewayImpl({ ...opts, stripe }).constructEvent('{}', 'forged')).toBeNull();
  });
});
