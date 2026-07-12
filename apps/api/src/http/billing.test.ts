import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { BillingService } from '../services/billing/billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../adapters/billing/stub-stripe.js';

let server: Server;
let base: string;
let deps: TestDeps;
let subs: InMemorySubscriptionRepository;

beforeAll(async () => {
  subs = new InMemorySubscriptionRepository();
  const billing = new BillingService(subs, new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 7);
  deps = buildInMemoryDeps({ billing });
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
async function client(token: string): Promise<string> {
  const res = await fetch(`${base}/clients`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'C' }) });
  return ((await res.json()) as { id: string }).id;
}

describe('[P5-1/P5-2] trial + billing over HTTP', () => {
  it('a new signup is trialing with full access to paid features', async () => {
    const { token } = await signup('trial-http@example.com');
    const status = (await (await fetch(`${base}/billing/status`, { headers: { authorization: `Bearer ${token}` } })).json()) as { entitled: boolean; status: string };
    expect(status.entitled).toBe(true);
    expect(status.status).toBe('trialing');
    const clientId = await client(token);
    expect((await fetch(`${base}/clients/${clientId}/brief`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  // NEGATIVE: a client success redirect (no webhook) must NOT grant paid access.
  it('locks paid features once the trial expires with no webhook', async () => {
    const { token, userId } = await signup('expire-http@example.com');
    // Force the trial into the past.
    (await subs.get(userId))!.trialEndsAt = Date.now() - 1000;
    const clientId = await client(token);
    expect((await fetch(`${base}/clients/${clientId}/brief`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(402);
  });

  it('a webhook (source of truth) flips the account to active', async () => {
    const { token, userId } = await signup('webhook-http@example.com');
    (await subs.get(userId))!.trialEndsAt = Date.now() - 1000; // trial over
    const evt = JSON.stringify({ id: 'evt_http_1', type: 'checkout.session.completed', userId, customerId: 'cus_http_1' });
    const wh = await fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 'whsec_test' }, body: evt });
    expect(wh.status).toBe(200);
    const status = (await (await fetch(`${base}/billing/status`, { headers: { authorization: `Bearer ${token}` } })).json()) as { entitled: boolean; status: string };
    expect(status.entitled).toBe(true);
    expect(status.status).toBe('active');
  });

  it('rejects a webhook with a bad signature (400)', async () => {
    const evt = JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed', userId: 'x' });
    expect((await fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 'nope' }, body: evt })).status).toBe(400);
  });

  it('returns a checkout url and requires auth for status', async () => {
    const { token } = await signup('checkout-http@example.com');
    const url = (await (await fetch(`${base}/billing/checkout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).json()) as { url: string };
    expect(url.url).toContain('checkout.stripe.test');
    expect((await fetch(`${base}/billing/status`)).status).toBe(401);
  });

  // [P5-4] consent
  it('rejects signup when consent is explicitly refused', async () => {
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'noconsent@example.com', password: 'password123', consent: false }) });
    expect(res.status).toBe(400);
  });
});
