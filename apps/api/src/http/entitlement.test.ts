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
const subs = new InMemorySubscriptionRepository();

beforeAll(async () => {
  const billing = new BillingService(subs, new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 7);
  deps = buildInMemoryDeps({ billing });
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const GET = (p: string, t: string) => fetch(`${base}${p}`, { headers: H(t) });
const POST = (p: string, t: string, body: unknown) => fetch(`${base}${p}`, { method: 'POST', headers: H(t), body: JSON.stringify(body) });

// Every premium surface, exercised against the same account before/after lapse.
const GATED: Array<[string, (t: string) => Promise<Response>]> = [
  ['GET /today', (t) => GET('/today', t)],
  ['GET /hero/patterns', (t) => GET('/hero/patterns', t)],
  ['GET /book-scan', (t) => GET('/book-scan', t)],
  ['GET /monday-digest', (t) => GET('/monday-digest', t)],
  ['POST /recall', (t) => POST('/recall', t, { question: 'what did they say?' })],
  ['POST /notes/:id/follow-up', (t) => POST('/notes/any-note-id/follow-up', t, {})],
];

describe('[P5-1/P5-2 ENTITLEMENT] premium surfaces gate on a lapsed trial', () => {
  it('an in-window trial has full access (no 402 on any gated surface)', async () => {
    const { token } = await signup('trialing@example.com');
    for (const [name, call] of GATED) {
      const res = await call(token);
      expect(res.status, `${name} while trialing`).not.toBe(402);
    }
  });

  it('a lapsed trial gets 402 with no feature data on EVERY gated surface', async () => {
    const { token, userId } = await signup('lapsed@example.com');
    (await subs.get(userId))!.trialEndsAt = Date.now() - 1000; // trial over, no webhook
    for (const [name, call] of GATED) {
      const res = await call(token);
      expect(res.status, `${name} while lapsed`).toBe(402);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error, name).toBe('payment_required');
      // no feature payload leaks past the gate
      for (const k of ['actions', 'answer', 'items', 'draft', 'contact', 'promisesDue']) expect(body[k], `${name}.${k}`).toBeUndefined();
    }
  });

  // The doctrine: a lapsed rep is NEVER locked out of their own data or leaving.
  it('capture and export still work while the trial is lapsed', async () => {
    const { token, userId } = await signup('lapsed-capture@example.com');
    const client = (await (await POST('/clients', token, { name: 'Acme' })).json()) as { id: string };
    (await subs.get(userId))!.trialEndsAt = Date.now() - 1000; // lapse it
    // capture a paste note — allowed
    expect((await POST(`/clients/${client.id}/notes/paste`, token, { text: 'a message' })).status).toBe(201);
    // export the whole book — allowed
    expect((await GET('/account/export', token)).status).toBe(200);
    // and the login/settings/billing surfaces are reachable (billing status)
    expect((await GET('/billing/status', token)).status).toBe(200);
  });
});
