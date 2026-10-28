import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { StubPushSender } from '../adapters/push/stub-sender.js';
import { listenForTest } from '../test-support/listen.js';

let server: Server;
let base: string;
let deps: TestDeps;
let sender: StubPushSender;

beforeAll(async () => {
  sender = new StubPushSender();
  deps = buildInMemoryDeps({ pushSender: sender });
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return ((await res.json()) as { token: string }).token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'key', auth: 'auth' } };

describe('[P3-6] web push subscription + test notification', () => {
  it('subscribes and delivers a test notification', async () => {
    const token = await signup('push@example.com');
    expect((await fetch(`${base}/push/subscribe`, { method: 'POST', headers: auth(token), body: JSON.stringify(sub) })).status).toBe(201);
    const test = await fetch(`${base}/push/test`, { method: 'POST', headers: auth(token) });
    expect(test.status).toBe(200);
    expect(((await test.json()) as { sent: number }).sent).toBe(1);
    expect(sender.sent.at(-1)!.subscription.endpoint).toBe(sub.endpoint);
  });

  it('rejects an invalid subscription (400)', async () => {
    const token = await signup('badsub@example.com');
    const res = await fetch(`${base}/push/subscribe`, { method: 'POST', headers: auth(token), body: JSON.stringify({ nope: true }) });
    expect(res.status).toBe(400);
  });

  it('requires auth to subscribe (401)', async () => {
    const res = await fetch(`${base}/push/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
    expect(res.status).toBe(401);
  });

  it('a rep with no subscription simply gets zero test notifications (no crash)', async () => {
    const token = await signup('nosub@example.com');
    const test = await fetch(`${base}/push/test`, { method: 'POST', headers: auth(token) });
    expect(((await test.json()) as { sent: number }).sent).toBe(0);
  });
});

// [P46-2] Owner (phone review): Settings said "Notifications are on" but the test went to 0 devices. The live web build
// never had a VAPID key, so it never subscribed. The app now asks the server for the public key, checks that THIS
// device's subscription is stored, and the test reports on this phone. A subscription the push service rejects as gone
// (404 / 410) is deleted, and one dead device never stops the others getting the push.
describe('[P46-2] push: the key from the server, this device, gone subscriptions', () => {
  it('GET /push/config gives the VAPID public key (never the private key)', async () => {
    const token = await signup('cfg@example.com');
    const res = await fetch(`${base}/push/config`, { headers: auth(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ vapidPublicKey: 'test-vapid-public' });
  });

  it('POST /push/status says whether THIS device (its endpoint) is stored for the rep', async () => {
    const token = await signup('status@example.com');
    const ask = async (endpoint: string) => ((await (await fetch(`${base}/push/status`, { method: 'POST', headers: auth(token), body: JSON.stringify({ endpoint }) })).json()) as { stored: boolean }).stored;
    expect(await ask(sub.endpoint)).toBe(false);
    await fetch(`${base}/push/subscribe`, { method: 'POST', headers: auth(token), body: JSON.stringify(sub) });
    expect(await ask(sub.endpoint)).toBe(true);
    expect(await ask('https://push.example/other-phone')).toBe(false);
  });

  it('NEGATIVE: another rep\'s stored endpoint is not "stored" for me', async () => {
    const a = await signup('status-a@example.com');
    const b = await signup('status-b@example.com');
    const mine = { endpoint: 'https://push.example/a-only', keys: { p256dh: 'k', auth: 'a' } };
    await fetch(`${base}/push/subscribe`, { method: 'POST', headers: auth(a), body: JSON.stringify(mine) });
    const res = await fetch(`${base}/push/status`, { method: 'POST', headers: auth(b), body: JSON.stringify({ endpoint: mine.endpoint }) });
    expect(((await res.json()) as { stored: boolean }).stored).toBe(false);
  });

  it('the test reports on this phone: "sent", or "not_set_up" when this endpoint is not stored', async () => {
    const token = await signup('thisphone@example.com');
    const test = async (endpoint: string) => (await (await fetch(`${base}/push/test`, { method: 'POST', headers: auth(token), body: JSON.stringify({ endpoint }) })).json()) as { sent: number; thisDevice: string };
    expect((await test(sub.endpoint)).thisDevice).toBe('not_set_up');
    await fetch(`${base}/push/subscribe`, { method: 'POST', headers: auth(token), body: JSON.stringify(sub) });
    expect(await test(sub.endpoint)).toEqual({ sent: 1, thisDevice: 'sent' });
  });

  it('a subscription the push service says is gone (410) is deleted, reported, and the other device still gets the push', async () => {
    const token = await signup('gone@example.com');
    const dead = { endpoint: 'https://push.example/dead', keys: { p256dh: 'k', auth: 'a' } };
    const live = { endpoint: 'https://push.example/live', keys: { p256dh: 'k', auth: 'a' } };
    for (const s of [dead, live]) await fetch(`${base}/push/subscribe`, { method: 'POST', headers: auth(token), body: JSON.stringify(s) });
    sender.goneEndpoints.add(dead.endpoint);
    const res = (await (await fetch(`${base}/push/test`, { method: 'POST', headers: auth(token), body: JSON.stringify({ endpoint: dead.endpoint }) })).json()) as { sent: number; thisDevice: string };
    expect(res).toEqual({ sent: 1, thisDevice: 'gone' });
    const status = await fetch(`${base}/push/status`, { method: 'POST', headers: auth(token), body: JSON.stringify({ endpoint: dead.endpoint }) });
    expect(((await status.json()) as { stored: boolean }).stored).toBe(false);
    sender.goneEndpoints.clear();
  });
});
