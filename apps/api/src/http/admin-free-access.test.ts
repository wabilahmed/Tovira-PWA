import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P72-2 · owner] Admin → "Give free access": type the email of an existing account, press Give free access, and
 * the account is paid until revoked (no Stripe subscription). Any account, by email. Every grant and revoke is in
 * the admin audit log. Only a signed-in admin (2FA done) can do it; a rep session never can.
 */
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(): Promise<{ base: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps();
  server = createApiServer(deps);
  const base = await listenForTest(server);
  return { base, deps };
}
const json = (cookie: string) => ({ 'content-type': 'application/json', cookie });
async function rep(base: string, email: string): Promise<string> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string };
  return b.token;
}
const status = async (base: string, token: string) => (await (await fetch(`${base}/billing/status`, { headers: { authorization: `Bearer ${token}` } })).json()) as { entitled: boolean; status: string; freeAccess?: boolean };
type Account = { email: string; since: number; by: string };

describe('[P72-2] Give free access, by email', () => {
  it('gives it to an existing account (any case), the rep is paid at once, the list shows it, and it is audited', async () => {
    const { base, deps } = await start();
    const t = await rep(base, 'dana@example.ae');
    const { cookie } = await signInAdmin(base, deps);
    const r = await fetch(`${base}/admin/free-access`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ email: '  Dana@Example.AE ' }) });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { account: Account }).account).toMatchObject({ email: 'dana@example.ae', by: 'wabil@tovira.io' });
    expect(await status(base, t)).toMatchObject({ entitled: true, status: 'active', freeAccess: true });
    const { accounts } = (await (await fetch(`${base}/admin/free-access`, { headers: { cookie } })).json()) as { accounts: Account[] };
    expect(accounts.map((a) => a.email)).toEqual(['dana@example.ae']);
    const { entries } = (await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ action: string; target: string }> };
    expect(entries[0]).toMatchObject({ action: 'free_access.grant', target: 'dana@example.ae' });
  });

  it('Revoke takes it away at once, and is audited', async () => {
    const { base, deps } = await start();
    const t = await rep(base, 'dana@example.ae');
    const { cookie } = await signInAdmin(base, deps);
    await fetch(`${base}/admin/free-access`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ email: 'dana@example.ae' }) });
    const r = await fetch(`${base}/admin/free-access/revoke`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ email: 'dana@example.ae' }) });
    expect(r.status).toBe(200);
    expect((await status(base, t)).freeAccess).toBeUndefined();
    expect(((await (await fetch(`${base}/admin/free-access`, { headers: { cookie } })).json()) as { accounts: Account[] }).accounts).toEqual([]);
    const actions = ((await (await fetch(`${base}/admin/audit`, { headers: { cookie } })).json()) as { entries: Array<{ action: string }> }).entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['free_access.grant', 'free_access.revoke']));
  });

  it('NEGATIVE: an email with no account is 404 (nothing is created), a non-email is 400', async () => {
    const { base, deps } = await start();
    const { cookie } = await signInAdmin(base, deps);
    const r = await fetch(`${base}/admin/free-access`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ email: 'nobody@example.ae' }) });
    expect(r.status).toBe(404);
    expect(((await r.json()) as { message: string }).message).toBe('No account uses that email.');
    expect((await fetch(`${base}/admin/free-access`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ email: 'not an email' }) })).status).toBe(400);
    expect((await fetch(`${base}/admin/free-access/revoke`, { method: 'POST', headers: json(cookie), body: JSON.stringify({ email: 'nobody@example.ae' }) })).status).toBe(404);
    expect(((await (await fetch(`${base}/admin/free-access`, { headers: { cookie } })).json()) as { accounts: Account[] }).accounts).toEqual([]);
  });

  it('NEGATIVE: no admin session, a half-signed-in admin (no 2FA) or a rep session cannot list, give or revoke', async () => {
    const { base, deps } = await start();
    const t = await rep(base, 'dana@example.ae');
    const body = JSON.stringify({ email: 'dana@example.ae' });
    const variants: Array<Record<string, string>> = [{ 'content-type': 'application/json' }, { 'content-type': 'application/json', authorization: `Bearer ${t}` }];
    for (const headers of variants) {
      expect((await fetch(`${base}/admin/free-access`, { headers })).status).toBe(401);
      expect((await fetch(`${base}/admin/free-access`, { method: 'POST', headers, body })).status).toBe(401);
      expect((await fetch(`${base}/admin/free-access/revoke`, { method: 'POST', headers, body })).status).toBe(401);
    }
    const half = await signInAdmin(base, deps, { enrol: false });
    expect((await fetch(`${base}/admin/free-access`, { method: 'POST', headers: json(half.cookie), body })).status).not.toBe(200);
    expect((await status(base, t)).freeAccess).toBeUndefined();
  });
});
