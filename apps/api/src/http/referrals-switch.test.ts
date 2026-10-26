import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import type { ApiDeps } from '../server.js';
import { loadConfig } from '../config.js';

// [P46-3] Owner: referrals are hidden behind REFERRALS_ENABLED, off by default. The public /version payload carries the
// switch so every screen hides the share card, the referral link and any "free month" wording. Codes are still made
// and ?ref= is still captured, silently.
let server: Server | null = null;
async function start(over: Partial<ApiDeps>): Promise<string> {
  server = createApiServer(buildInMemoryDeps(over));
  await new Promise<void>((r) => server!.listen(0, r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });

describe('[P46-3] REFERRALS_ENABLED', () => {
  it('is off unless set to "true"', () => {
    const env = { DATABASE_URL: 'x' };
    expect(loadConfig(env).referralsEnabled).toBe(false);
    expect(loadConfig({ ...env, REFERRALS_ENABLED: 'yes' }).referralsEnabled).toBe(false);
    expect(loadConfig({ ...env, REFERRALS_ENABLED: 'true' }).referralsEnabled).toBe(true);
  });

  it('/version says referralsEnabled: false by default, true when on', async () => {
    let base = await start({});
    expect(((await (await fetch(`${base}/version`)).json()) as { referralsEnabled: boolean }).referralsEnabled).toBe(false);
    await new Promise<void>((r) => server!.close(() => r())); server = null;
    base = await start({ referralsEnabled: true });
    expect(((await (await fetch(`${base}/version`)).json()) as { referralsEnabled: boolean }).referralsEnabled).toBe(true);
  });

  it('a new rep still gets a random referral code (not their id) with the switch off', async () => {
    const base = await start({ signupEnabled: true });
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'r@x.ae', password: 'password123' }) });
    const { user } = (await res.json()) as { user: { id: string; referralCode: string } };
    expect(user.referralCode).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(user.referralCode).not.toBe(user.id);
    expect(user.id).not.toContain(user.referralCode);
  });

  it('NEGATIVE: no email template says "free month" or "referral"', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('../services/email/', import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.includes('.test.'))) {
      expect(readFileSync(new URL(f, dir), 'utf8')).not.toMatch(/free month|referral|refer a/i);
    }
  });
});
