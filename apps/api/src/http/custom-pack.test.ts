import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P83 · owner, 21 Nov] Packs and the custom pack. The rep types how many messages; the SERVER prices it (AED 33 per
 * 1,000 up to 4,999, AED 30 per 1,000 from 5,000, exact) and opens a one-off Stripe payment at that price. Anything the
 * browser says about the price is ignored. The messages are added only when Stripe confirms the payment (the webhook),
 * exactly like the fixed packs.
 */
let server: Server;
let base: string;
let deps: TestDeps;
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function subscriber(email: string): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', consent: true }) })).json()) as { token: string; user: { id: string } };
  await fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 'whsec_test', 'content-type': 'application/json' }, body: JSON.stringify({ id: `evt_sub_${b.user.id}`, type: 'checkout.session.completed', userId: b.user.id }) });
  return { token: b.token, userId: b.user.id };
}
const buy = (token: string, body: unknown) => fetch(`${base}/billing/top-up`, { method: 'POST', headers: H(token), body: JSON.stringify(body) });
const paid = (id: string, userId: string, optionId: string, amountTotalFils: number) => fetch(`${base}/billing/webhook`, {
  method: 'POST', headers: { 'stripe-signature': 'whsec_test', 'content-type': 'application/json' },
  body: JSON.stringify({ id, type: 'checkout.session.completed', mode: 'payment', userId, topUpOptionId: optionId, amountTotalFils }),
});
const lastCheckout = () => deps.stripeStub.topUps[deps.stripeStub.topUps.length - 1]!;
const status = async (token: string) => (await (await fetch(`${base}/allowance/status`, { headers: H(token) })).json()) as Record<string, unknown>;

describe('[P83] the custom pack checkout', () => {
  it('the server prices it at the boundaries: 1,000 = AED 33.00, 5,000 = AED 150.00, 50,000 = AED 1,500.00', async () => {
    const { token } = await subscriber('custom-bounds@example.com');
    for (const [messages, aed] of [[1000, 33], [4500, 148.5], [5000, 150], [50_000, 1500]] as const) {
      expect((await buy(token, { messages })).status).toBe(200);
      expect(lastCheckout()).toMatchObject({ topUpOptionId: `custom_${messages}`, amountAed: aed });
    }
  });

  it('exact to 2 decimals: 1,500 = AED 49.50, 2,000 = AED 66.00', async () => {
    const { token } = await subscriber('custom-exact@example.com');
    await buy(token, { messages: 1500 });
    expect(lastCheckout().amountAed.toFixed(2)).toBe('49.50');
    await buy(token, { messages: 2000 });
    expect(lastCheckout().amountAed.toFixed(2)).toBe('66.00');
  });

  it('NEGATIVE: a price sent by the browser is ignored; the server recalculates from the message count', async () => {
    const { token } = await subscriber('custom-tamper@example.com');
    expect((await buy(token, { messages: 2000, priceAed: 1, amountAed: 1, price: 1, amountFils: 100 })).status).toBe(200);
    expect(lastCheckout().amountAed).toBe(66);
  });

  it('NEGATIVE: out of range or off the step is refused with a clear message, and no checkout is opened', async () => {
    const { token } = await subscriber('custom-range@example.com');
    const before = deps.stripeStub.topUps.length;
    for (const [messages, message] of [
      [999, 'The smallest amount is 1,000 messages.'],
      [50_500, 'The largest amount is 50,000 messages.'],
      [4999, 'Choose a number in steps of 500 (for example 4,500 or 5,000).'],
      ['lots', 'Type how many messages you want, from 1,000 to 50,000.'],
    ] as const) {
      const res = await buy(token, { messages });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toBe(message);
    }
    expect(deps.stripeStub.topUps.length).toBe(before);
  });

  it('NEGATIVE: a trial account cannot buy a custom pack', async () => {
    const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'custom-trial@example.com', password: 'password123', consent: true }) })).json()) as { token: string };
    expect((await buy(b.token, { messages: 2000 })).status).toBe(403);
  });

  it('messages are added only after the webhook confirms payment, and the Subscription page shows "+N messages added"', async () => {
    const { token, userId } = await subscriber('custom-webhook@example.com');
    const before = await status(token);
    await buy(token, { messages: 2500 });
    expect(await status(token)).toMatchObject({ messagesTotal: before.messagesTotal, lastTopupMessages: null }); // checkout alone adds nothing
    expect((await paid('evt_custom_2500', userId, 'custom_2500', 8250)).status).toBe(200);
    const after = await status(token);
    expect(after).toMatchObject({ messagesTotal: 12_500, packMessagesLeft: 2500, lastTopupMessages: 2500 });
    expect((await paid('evt_custom_2500', userId, 'custom_2500', 8250)).status).toBe(200); // a replay adds nothing
    expect((await status(token)).messagesTotal).toBe(12_500);
  });

  it('NEGATIVE: a custom pack whose payment does not match the server price is never credited', async () => {
    const { token, userId } = await subscriber('custom-mismatch@example.com');
    await paid('evt_custom_cheap', userId, 'custom_5000', 100);
    expect((await status(token)).messagesTotal).toBe(10_000);
  });

  it('a fixed pack adds its messages after the webhook (+1,500 for AED 50)', async () => {
    const { token, userId } = await subscriber('fixed-pack@example.com');
    expect((await buy(token, { optionId: 'topup_50', priceAed: 1 })).status).toBe(200);
    expect(lastCheckout()).toMatchObject({ topUpOptionId: 'topup_50', amountAed: 50 });
    await paid('evt_fixed_50', userId, 'topup_50', 5000);
    expect(await status(token)).toMatchObject({ messagesTotal: 11_500, lastTopupMessages: 1500 });
  });

  it('the success page names what was bought: "+N messages added"', async () => {
    const { token, userId } = await subscriber('custom-receipt@example.com');
    const r = (await (await fetch(`${base}/billing/success?session_id=cs_topup_${userId}_custom_3500`, { headers: H(token) })).json()) as { paid: boolean; messagesAdded?: number };
    expect(r).toMatchObject({ paid: true, messagesAdded: 3500 });
  });

  it('the status carries the packs and the custom range (no percentages)', async () => {
    const { token } = await subscriber('custom-status@example.com');
    const s = await status(token);
    expect(s.options).toEqual([
      { id: 'topup_50', label: '+1,500 messages', messages: 1500, priceAed: 50 },
      { id: 'topup_100', label: '+3,000 messages', messages: 3000, priceAed: 100 },
      { id: 'topup_150', label: '+5,000 messages', messages: 5000, priceAed: 150 },
    ]);
    expect(s.custom).toEqual({ min: 1000, max: 50_000, step: 500, bands: [{ from: 1000, filsPer1000: 3300 }, { from: 5000, filsPer1000: 3000 }] });
    for (const k of ['percentUsed', 'rawPercentUsed', 'extraPercentLeft']) expect(s).not.toHaveProperty(k);
  });
});
