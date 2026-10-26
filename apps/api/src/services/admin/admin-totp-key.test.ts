import { describe, it, expect } from 'vitest';
import { AdminAuthService } from './admin-auth-service.js';
import { SecretBox, LegacySecretBox } from './secret-box.js';
import { reencryptAdminTotp } from './reencrypt-totp.js';
import { InMemoryAdminStore } from '../../adapters/admin/in-memory-admin-store.js';
import { ScryptHasher } from '../auth/password.js';
import { totpCode, generateTotpSecret } from './totp.js';
import type { EmailMessage } from '../../ports/email.js';
import { loadConfig } from '../../config.js';

/**
 * [P46-6c.1] Owner: the 2FA key must not come from OPS_TOKEN (a shared script and CI secret: anything holding it could
 * read the admin's second factor, and rotating it silently broke admin 2FA). TOTP secrets are sealed with a dedicated
 * ADMIN_TOTP_KEY. An admin already enrolled under the old OPS_TOKEN-derived key is re-encrypted on deploy, so no one
 * enrols again. Without ADMIN_TOTP_KEY admin login refuses with a clear message; it never falls back to OPS_TOKEN.
 */
const EMAIL = 'wabil@tovira.io';
const KEY = 'a-dedicated-admin-totp-key-for-tests-0123456789';
function svcFor(store: InMemoryAdminStore, totpKey: string | null, now: { t: number }, sent: EmailMessage[] = []) {
  return new AdminAuthService({ store, hasher: new ScryptHasher(), adminEmails: [EMAIL], totpKey, appBaseUrl: 'https://tovira.io', email: { send: async (m) => { sent.push(m); } }, now: () => now.t });
}
async function enrol(store: InMemoryAdminStore, totpKey: string, now: { t: number }) {
  const sent: EmailMessage[] = [];
  const svc = svcFor(store, totpKey, now, sent);
  await svc.createAdmin(EMAIL, { apply: true });
  const inv = /token=([A-Za-z0-9_-]+)/.exec(sent[0]!.text)![1]!;
  const { token } = await svc.setPassword(inv, 'a long admin passphrase');
  const { secret } = await svc.enrolStart(token);
  await svc.enrolConfirm(token, totpCode(secret, now.t));
  return secret;
}
async function signIn(svc: AdminAuthService, secret: string, now: { t: number }) {
  const { token } = await svc.login(EMAIL, 'a long admin passphrase');
  await svc.verifyMfa(token, totpCode(secret, now.t));
  return (await svc.session(token))?.stage;
}

describe('[P46-6c.1] ADMIN_TOTP_KEY', () => {
  it('config reads ADMIN_TOTP_KEY; NEGATIVE: never takes it from OPS_TOKEN', () => {
    expect(loadConfig({ DATABASE_URL: 'x', ADMIN_TOTP_KEY: KEY }).adminTotpKey).toBe(KEY);
    expect(loadConfig({ DATABASE_URL: 'x', OPS_TOKEN: 'ops-token-value' }).adminTotpKey).toBeNull();
    expect(loadConfig({ DATABASE_URL: 'x', ADMIN_TOTP_KEY: 'REPLACE_ME' }).adminTotpKey).toBeNull(); // the fresh-env seed is not a key
  });

  it('a stored TOTP secret is sealed with the dedicated key (v2), never readable with an OPS_TOKEN-derived key', async () => {
    const store = new InMemoryAdminStore();
    const now = { t: 1_800_000_000_000 };
    await enrol(store, KEY, now);
    const sealed = [...store.users.values()][0]!.totpSecretEnc!;
    expect(sealed.startsWith('v2.')).toBe(true);
    expect(() => new LegacySecretBox(KEY).open(sealed)).toThrow();
    expect(() => new LegacySecretBox('ops-token-value').open(sealed)).toThrow();
  });

  it('changing OPS_TOKEN does not affect 2FA (the service never sees it)', async () => {
    const store = new InMemoryAdminStore();
    const now = { t: 1_800_000_000_000 };
    const secret = await enrol(store, KEY, now);
    now.t += 60_000;
    process.env.OPS_TOKEN = 'rotated-ops-token';
    try {
      expect(await signIn(svcFor(store, KEY, now), secret, now)).toBe('ok');
    } finally {
      delete process.env.OPS_TOKEN;
    }
  });

  it('NEGATIVE: without ADMIN_TOTP_KEY admin login refuses with a clear message', async () => {
    const store = new InMemoryAdminStore();
    const now = { t: 1_800_000_000_000 };
    await enrol(store, KEY, now);
    await expect(svcFor(store, null, now).login(EMAIL, 'a long admin passphrase')).rejects.toThrow('Admin sign-in is unavailable: the two-factor key (ADMIN_TOTP_KEY) is not set on the server.');
  });

  it('re-encryption: an admin enrolled under the OPS_TOKEN-derived key keeps working with the new key, without enrolling again', async () => {
    const store = new InMemoryAdminStore();
    const now = { t: 1_800_000_000_000 };
    // An admin enrolled before P46: the secret sealed v1 with the OPS_TOKEN-derived key.
    const secret = generateTotpSecret();
    const admin = await store.createUser(EMAIL, now.t);
    await store.updateUser(admin.id, { passwordHash: await new ScryptHasher().hash('a long admin passphrase'), totpSecretEnc: new LegacySecretBox('old-ops-token').seal(secret), totpEnrolledAt: now.t });
    // NEGATIVE: before re-encryption the new service cannot read it (no fallback to OPS_TOKEN)
    await expect(signIn(svcFor(store, KEY, now), secret, now)).rejects.toThrow();
    const out = await reencryptAdminTotp({ store, legacySecret: 'old-ops-token', totpKey: KEY });
    expect(out).toEqual({ reencrypted: 1, alreadyCurrent: 0, failed: 0 });
    now.t += 60_000;
    expect(await signIn(svcFor(store, KEY, now), secret, now)).toBe('ok');
    expect((await reencryptAdminTotp({ store, legacySecret: 'old-ops-token', totpKey: KEY }))).toEqual({ reencrypted: 0, alreadyCurrent: 1, failed: 0 }); // idempotent
  });

  it('NEGATIVE: re-encryption with the wrong old secret changes nothing and reports it', async () => {
    const store = new InMemoryAdminStore();
    const admin = await store.createUser(EMAIL, 1);
    const sealed = new LegacySecretBox('old-ops-token').seal(generateTotpSecret());
    await store.updateUser(admin.id, { totpSecretEnc: sealed });
    expect(await reencryptAdminTotp({ store, legacySecret: 'not-the-old-token', totpKey: KEY })).toEqual({ reencrypted: 0, alreadyCurrent: 0, failed: 1 });
    expect([...store.users.values()][0]!.totpSecretEnc).toBe(sealed);
  });

  it('SecretBox seals and opens with the dedicated key', () => {
    const box = new SecretBox(KEY);
    expect(box.open(box.seal('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
    expect(() => new SecretBox('another-key-entirely-0123456789').open(box.seal('x'))).toThrow();
  });
});
