import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, TEST_ADMIN_EMAIL, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import { totpCode } from '../services/admin/totp.js';

/** [P45-1] The admin API's sign-in: password, then 2FA; nothing else until 2FA is done; logout; the audit log. */
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(): Promise<{ base: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server!.listen(0, r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, deps };
}
const json = (cookie?: string) => ({ 'content-type': 'application/json', ...(cookie ? { cookie } : {}) });

describe('[P45-1] admin sign-in over HTTP', () => {
  it('the session cookie is HttpOnly, SameSite=Strict and scoped to the admin API', async () => {
    const { base, deps } = await start();
    await deps.adminAuth.createAdmin(TEST_ADMIN_EMAIL, { apply: true });
    const invite = /token=([A-Za-z0-9_-]+)/.exec(deps.emailSender.sent.at(-1)!.text)![1]!;
    const r = await fetch(`${base}/admin/auth/set-password`, { method: 'POST', headers: json(), body: JSON.stringify({ token: invite, password: 'a long admin passphrase' }) });
    const c = r.headers.get('set-cookie')!;
    expect(c).toMatch(/^admin_session=/);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Path=\/api\/admin/);
  });

  it('2FA is required: before enrolment the console\'s data is refused (403)', async () => {
    const { base, deps } = await start();
    const { cookie } = await signInAdmin(base, deps, { enrol: false });
    expect((await (await fetch(`${base}/admin/auth/me`, { headers: { cookie } })).json())).toEqual({ email: TEST_ADMIN_EMAIL, stage: 'enrol_required' });
    expect((await fetch(`${base}/admin/audit`, { headers: { cookie } })).status).toBe(403);
  });

  it('after enrolment: logout, then a password login still needs the code before anything', async () => {
    const { base, deps } = await start();
    const { cookie, secret } = await signInAdmin(base, deps);
    expect((await fetch(`${base}/admin/audit`, { headers: { cookie } })).status).toBe(200);
    await fetch(`${base}/admin/auth/logout`, { method: 'POST', headers: json(cookie), body: '{}' });
    expect((await fetch(`${base}/admin/audit`, { headers: { cookie } })).status).toBe(401);
    const login = await fetch(`${base}/admin/auth/login`, { method: 'POST', headers: json(), body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: 'a long admin passphrase' }) });
    expect(await login.json()).toEqual({ stage: 'mfa_required' });
    const c2 = `admin_session=${/admin_session=([^;]*)/.exec(login.headers.get('set-cookie')!)![1]}`;
    expect((await fetch(`${base}/admin/audit`, { headers: { cookie: c2 } })).status).toBe(403);
    await new Promise((r) => setTimeout(r, 0));
    const code = totpCode(secret!, Date.now() + 30_000); // the next step (the enrolment code used this one)
    expect((await fetch(`${base}/admin/auth/mfa`, { method: 'POST', headers: json(c2), body: JSON.stringify({ code }) })).status).toBe(200);
    expect((await fetch(`${base}/admin/audit`, { headers: { cookie: c2 } })).status).toBe(200);
  });

  it('the audit log records sign-ins and 2FA enrolment, with who and when', async () => {
    const { base, deps } = await start();
    const { cookie } = await signInAdmin(base, deps);
    const { entries } = (await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ adminEmail: string; action: string; at: number }> };
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(['admin.created', 'admin.2fa_enrolled']));
    expect(entries.find((e) => e.action === 'admin.2fa_enrolled')).toMatchObject({ adminEmail: TEST_ADMIN_EMAIL });
  });

  it('NEGATIVE: a write needs a JSON body (no cross-site form post); too many login attempts are slowed', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' })).status).toBe(400);
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await fetch(`${base}/admin/auth/login`, { method: 'POST', headers: json(), body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: 'wrong' }) })).status;
    expect(last).toBe(429);
  });
});
