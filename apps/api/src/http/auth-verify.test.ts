import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { AccountEmailService } from '../services/email/account-email-service.js';
import { StubEmailSender } from '../adapters/email/stub-email-sender.js';
import { InMemoryEmailLogRepository } from '../adapters/email/in-memory-email-log-repository.js';
import { VERIFY_RESEND_LIMIT } from '../services/auth/auth-service.js';

let server: Server;
let base: string;
const email = new StubEmailSender();

beforeAll(async () => {
  const deps = buildInMemoryDeps({ accountEmail: new AccountEmailService(email, new InMemoryEmailLogRepository()) });
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const post = (path: string, body?: unknown, cookie?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
const get = (path: string, cookie?: string) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });

/** Sign up and return the session cookie (first cookie pair). */
async function signup(e: string): Promise<string> {
  const res = await post('/auth/signup', { email: e, password: 'password123' });
  expect(res.status).toBe(201);
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}
const me = async (cookie: string): Promise<{ emailVerified: boolean }> => {
  const body = (await (await get('/me', cookie)).json()) as { user: { emailVerified: boolean } };
  return body.user;
};
const verifyEmails = (to: string) => email.to(to).filter((m) => /confirm your email/i.test(m.subject));
const welcomeEmails = (to: string) => email.to(to).filter((m) => /welcome to tovira/i.test(m.subject));
const tokenFrom = (text: string): string => decodeURIComponent(text.match(/verify-email\?token=([^\s]+)/)![1]!);

describe('[EMAIL-VERIFY] soft email verification over HTTP', () => {
  it('a fresh signup is unverified in /me', async () => {
    const cookie = await signup('fresh@example.com');
    expect((await me(cookie)).emailVerified).toBe(false);
  });

  it('an UNVERIFIED rep can still use every feature (verification never gates access)', async () => {
    const cookie = await signup('unverified@example.com');
    // capture path (open) — create a client
    expect((await post('/clients', { name: 'Rashid Auto' }, cookie)).status).toBe(201);
    // an entitlement-gated read still passes while trialing, though unverified
    expect((await get('/hero/status', cookie)).status).toBe(200);
    // the account is, indeed, still unverified
    expect((await me(cookie)).emailVerified).toBe(false);
  });

  it('the resent verification link marks the account verified (banner clears)', async () => {
    const cookie = await signup('resend@example.com');
    email.clear();
    expect((await post('/auth/resend-verification', {}, cookie)).status).toBe(200);
    const token = tokenFrom(verifyEmails('resend@example.com').at(-1)!.text);
    expect((await post('/auth/verify-email', { token }, cookie)).status).toBe(200);
    expect((await me(cookie)).emailVerified).toBe(true);
    // reused token now rejected
    expect((await post('/auth/verify-email', { token })).status).toBe(400);
  });

  it('the emailed WELCOME link also carries a working verification token', async () => {
    const cookie = await signup('welcome@example.com');
    // welcome is best-effort/async — give it a few ticks to land
    for (let i = 0; i < 50 && welcomeEmails('welcome@example.com').length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const welcome = welcomeEmails('welcome@example.com').at(-1)!;
    const token = tokenFrom(welcome.text);
    expect((await post('/auth/verify-email', { token }, cookie)).status).toBe(200);
    expect((await me(cookie)).emailVerified).toBe(true);
  });

  it('rejects a garbage token (400)', async () => {
    expect((await post('/auth/verify-email', { token: 'not-real' })).status).toBe(400);
  });

  it('rate-limits resend server-side: past the daily budget, 429', async () => {
    const cookie = await signup('limited@example.com');
    const statuses: number[] = [];
    // Attempt more than the daily budget; the signup welcome token also counts,
    // so successes are at most the limit and a 429 must appear.
    for (let i = 0; i < VERIFY_RESEND_LIMIT + 2; i++) {
      statuses.push((await post('/auth/resend-verification', {}, cookie)).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(VERIFY_RESEND_LIMIT);
  });

  it('resend requires a session (401 when signed out)', async () => {
    expect((await post('/auth/resend-verification', {})).status).toBe(401);
  });
});
