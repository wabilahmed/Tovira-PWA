import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { FixedWindowRateLimiter } from '../services/security/rate-limiter.js';

let server: Server;
let base: string;

beforeAll(async () => {
  // A tight limiter (3 failures/window) so the test is fast + deterministic.
  const deps = { ...buildInMemoryDeps(), loginLimiter: new FixedWindowRateLimiter(3, 60_000) };
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const login = (email: string, password: string) =>
  fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });

describe('login brute-force throttling', () => {
  it('locks out after too many failures — even a correct password is refused', async () => {
    const email = 'victim@tovira.test';
    await fetch(`${base}/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse9', consent: true }),
    });

    // 3 wrong guesses are answered 401 (generic — no enumeration).
    for (let i = 0; i < 3; i++) expect((await login(email, 'wrong-guess')).status).toBe(401);

    // The 4th attempt is throttled — and stays throttled for the RIGHT password.
    const blocked = await login(email, 'wrong-guess');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect((await login(email, 'correcthorse9')).status).toBe(429);
  });

  it('throttles per account — a different email is unaffected', async () => {
    const other = 'bystander@tovira.test';
    await fetch(`${base}/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: other, password: 'anotherpass9', consent: true }),
    });
    // This account has no failures, so a correct login still works.
    expect((await login(other, 'anotherpass9')).status).toBe(200);
  });
});
