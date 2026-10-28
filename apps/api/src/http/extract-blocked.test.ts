import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { BillingService } from '../services/billing/billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../adapters/billing/stub-stripe.js';
import { listenForTest } from '../test-support/listen.js';

// [P16-3c] A re-extract request for a note on a BLOCKED account must answer 402 with the reason — not a
// cheerful 202 the sweep will silently never honour.
let server: Server; let base: string; let deps: TestDeps;
const subs = new InMemorySubscriptionRepository();
beforeAll(async () => {
  const billing = new BillingService(subs, new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 7);
  deps = buildInMemoryDeps({ billing });
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}

describe('[P16-3c] POST /notes/:id/extract on a blocked account', () => {
  it('returns 402 with the reason (not 202) when the trial has lapsed', async () => {
    const { token, userId } = await signup('extract-blocked@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;
    const note = (await (await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'a quick note to extract' }) })).json()) as { id: string };
    (await subs.get(userId))!.trialEndsAt = Date.now() - 1000; // lapse → not entitled → extraction blocked 'subscribe'

    const res = await fetch(`${base}/notes/${note.id}/extract`, { method: 'POST', headers: H(token) });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('extraction_blocked');
    expect(body.reason).toBe('subscribe');
  });

  it('still 202-queues when the account is entitled (in trial)', async () => {
    const { token } = await signup('extract-ok@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;
    const note = (await (await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'another note' }) })).json()) as { id: string };
    const res = await fetch(`${base}/notes/${note.id}/extract`, { method: 'POST', headers: H(token) });
    expect(res.status).toBe(202);
  });
});
