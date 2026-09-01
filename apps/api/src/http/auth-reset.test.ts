import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { AccountEmailService } from '../services/email/account-email-service.js';
import { StubEmailSender } from '../adapters/email/stub-email-sender.js';
import { InMemoryEmailLogRepository } from '../adapters/email/in-memory-email-log-repository.js';
import type { EmailSender } from '../ports/email.js';

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

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const signup = (e: string) => post('/auth/signup', { email: e, password: 'password123' });
// Reset emails specifically — a (best-effort, async) welcome email may also land.
const resetEmails = (to: string) => email.to(to).filter((m) => /reset your tovira password/i.test(m.subject));
const tokenFromEmail = (to: string): string => {
  const link = resetEmails(to).at(-1)!.text.match(/reset-password\?token=([^\s]+)/)![1]!;
  return decodeURIComponent(link);
};

describe('[TASK EMAIL] password reset over HTTP', () => {
  it('forgot-password returns 200 for BOTH known and unknown emails (no enumeration)', async () => {
    await signup('known@example.com');
    email.clear();
    const known = await post('/auth/forgot-password', { email: 'known@example.com' });
    const unknown = await post('/auth/forgot-password', { email: 'nobody@example.com' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual({ ok: true });
    expect(await unknown.json()).toEqual({ ok: true });
    // ...but an email only goes to the real account.
    expect(resetEmails('known@example.com')).toHaveLength(1);
    expect(resetEmails('nobody@example.com')).toHaveLength(0);
  });

  it('resets the password via the emailed token, then the new password logs in', async () => {
    await signup('reset@example.com');
    email.clear();
    await post('/auth/forgot-password', { email: 'reset@example.com' });
    const token = tokenFromEmail('reset@example.com');
    expect((await post('/auth/reset-password', { token, password: 'brandnew123' })).status).toBe(200);
    expect((await post('/auth/login', { email: 'reset@example.com', password: 'brandnew123' })).status).toBe(200);
    expect((await post('/auth/login', { email: 'reset@example.com', password: 'password123' })).status).toBe(401);
    // reused token now rejected
    expect((await post('/auth/reset-password', { token, password: 'another123' })).status).toBe(400);
  });

  it('signup accepts consent:true and still rejects a forged consent:false (P5-4)', async () => {
    expect((await post('/auth/signup', { email: 'consent@example.com', password: 'password123', consent: true })).status).toBe(201);
    expect((await post('/auth/signup', { email: 'refuse@example.com', password: 'password123', consent: false })).status).toBe(400);
  });

  it('rejects a garbage token (400) and a weak password (400)', async () => {
    await signup('weak@example.com');
    email.clear();
    await post('/auth/forgot-password', { email: 'weak@example.com' });
    expect((await post('/auth/reset-password', { token: 'garbage', password: 'brandnew123' })).status).toBe(400);
    expect((await post('/auth/reset-password', { token: tokenFromEmail('weak@example.com'), password: 'short' })).status).toBe(400);
  });
});

// FORGOT-PW-500: a reset-email delivery failure (e.g. the provider is out of quota
// or an address is unverified) must NEVER turn forgot-password into a 500. A 500 for a
// KNOWN email while an UNKNOWN one returns 200 is an account-enumeration oracle. Same
// rule the lifecycle-email hooks already follow: a failing send is logged, the business
// action still succeeds. The reset token is still created; only delivery is best-effort.
describe('[FORGOT-PW-500] forgot-password survives an email delivery failure', () => {
  let s: Server;
  let b: string;
  // Throw only on the reset email so signup's (separate) welcome send is unaffected.
  const throwingSender: EmailSender = {
    send: async (m) => {
      if (/reset your tovira password/i.test(m.subject)) throw new Error('Resend: daily quota exceeded');
    },
  };
  beforeAll(async () => {
    const deps = buildInMemoryDeps({ accountEmail: new AccountEmailService(throwingSender, new InMemoryEmailLogRepository()) });
    s = createApiServer(deps);
    await new Promise<void>((r) => s.listen(0, r));
    b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => s.close(() => r()));
  });
  const p = (path: string, body: unknown) =>
    fetch(`${b}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('returns an identical 200 for known and unknown emails even when the send throws (no enumeration)', async () => {
    expect((await p('/auth/signup', { email: 'known@fail.example', password: 'password123' })).status).toBe(201);
    const known = await p('/auth/forgot-password', { email: 'known@fail.example' });
    const unknown = await p('/auth/forgot-password', { email: 'ghost@fail.example' });
    expect(known.status, 'known email must not 500 when delivery fails').toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.text()).toBe(await unknown.text()); // byte-identical → no oracle
  });
});
