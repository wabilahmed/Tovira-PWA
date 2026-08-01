import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const trialEnd = async (t: string) => ((await (await fetch(`${base}/billing/status`, { headers: auth(t) })).json()) as { trialEndsAt: number }).trialEndsAt;

async function clientWithNote(token: string, name: string): Promise<void> {
  const cid = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name }) })).json()) as { id: string }).id;
  await fetch(`${base}/clients/${cid}/notes/paste`, { method: 'POST', headers: auth(token), body: JSON.stringify({ text: 'a note' }) });
}

const DAY = 24 * 60 * 60 * 1000;

describe('[P5-1] activity-gated trial extension (server-side)', () => {
  it('extends the trial by 7 days after notes on 3 distinct clients', async () => {
    const token = await signup('extend@example.com');
    const before = await trialEnd(token);
    await clientWithNote(token, 'A');
    await clientWithNote(token, 'B');
    expect(await trialEnd(token)).toBe(before); // only 2 clients so far
    await clientWithNote(token, 'C');
    expect(await trialEnd(token) - before).toBe(7 * DAY); // 3 distinct → +7 days
  });

  // NEGATIVE: 3 notes on ONE client do not qualify.
  it('does not extend for 3 notes on a single client', async () => {
    const token = await signup('one-client@example.com');
    const before = await trialEnd(token);
    const cid = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Solo' }) })).json()) as { id: string }).id;
    for (let i = 0; i < 3; i++) {
      await fetch(`${base}/clients/${cid}/notes/paste`, { method: 'POST', headers: auth(token), body: JSON.stringify({ text: `note ${i}` }) });
    }
    expect(await trialEnd(token)).toBe(before);
  });

  // NEGATIVE: it can't be earned twice.
  it('extends only once even as more clients are added', async () => {
    const token = await signup('once@example.com');
    const before = await trialEnd(token);
    for (const n of ['A', 'B', 'C', 'D', 'E']) await clientWithNote(token, n);
    expect(await trialEnd(token) - before).toBe(7 * DAY); // exactly one +7, not more
  });
});
