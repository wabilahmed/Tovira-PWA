import { describe, it, expect, vi } from 'vitest';
import { StripeGatewayImpl, type StripeLike } from './stripe-gateway.js';

const opts = { secretKey: 'sk_test_x', webhookSecret: 'whsec_x', priceId: 'price_1', successUrl: 'http://s', cancelUrl: 'http://c' };

describe('StripeGatewayImpl', () => {
  it('creates a subscription checkout session tagged with the user id', async () => {
    const create = vi.fn(async (_params: { client_reference_id?: string; mode?: string }) => ({ url: 'https://checkout.stripe.com/abc', id: 'cs_1' }));
    const stripe = { checkout: { sessions: { create } }, webhooks: { constructEvent: () => ({}) } } as unknown as StripeLike;
    const g = new StripeGatewayImpl({ ...opts, stripe });
    const out = await g.createCheckoutSession('user-1', 'a@b.com');
    expect(out.url).toContain('checkout.stripe.com');
    expect(create.mock.calls[0]![0].client_reference_id).toBe('user-1');
    expect(create.mock.calls[0]![0].mode).toBe('subscription');
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
