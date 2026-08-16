import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { AccountEmailService } from '../services/email/account-email-service.js';
import { StubEmailSender } from '../adapters/email/stub-email-sender.js';
import { InMemoryEmailLogRepository } from '../adapters/email/in-memory-email-log-repository.js';

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

  it('rejects a garbage token (400) and a weak password (400)', async () => {
    await signup('weak@example.com');
    email.clear();
    await post('/auth/forgot-password', { email: 'weak@example.com' });
    expect((await post('/auth/reset-password', { token: 'garbage', password: 'brandnew123' })).status).toBe(400);
    expect((await post('/auth/reset-password', { token: tokenFromEmail('weak@example.com'), password: 'short' })).status).toBe(400);
  });
});
