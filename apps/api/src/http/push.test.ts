import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { StubPushSender } from '../adapters/push/stub-sender.js';

let server: Server;
let base: string;
let deps: TestDeps;
let sender: StubPushSender;

beforeAll(async () => {
  sender = new StubPushSender();
  deps = buildInMemoryDeps({ pushSender: sender });
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
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
