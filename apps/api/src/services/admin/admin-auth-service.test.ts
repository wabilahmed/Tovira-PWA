import { describe, it, expect } from 'vitest';
import { AdminAuthService, AdminAuthError } from './admin-auth-service.js';
import { InMemoryAdminStore } from '../../adapters/admin/in-memory-admin-store.js';
import { ScryptHasher } from '../auth/password.js';
import { totpCode } from './totp.js';
import type { EmailMessage } from '../../ports/email.js';

/**
 * [P45-1 · owner] Admin login: the email must be in ADMIN_EMAILS; the account is created by the create-admin script,
 * which emails a set-password link; 2FA (TOTP) is enrolled on first login and asked at every login after; 10
 * one-time recovery codes are shown once and stored hashed; a session that hasn't done 2FA can do nothing else;
 * sessions end after 12 hours idle.
 */
const EMAIL = 'wabil@tovira.io';
function setup(now = { t: 1_800_000_000_000 }) {
  const store = new InMemoryAdminStore();
  const sent: EmailMessage[] = [];
  const svc = new AdminAuthService({
    store, hasher: new ScryptHasher(), adminEmails: [EMAIL], totpKey: 'test-admin-totp-key-0123456789', appBaseUrl: 'https://tovira.io',
    email: { send: async (m) => { sent.push(m); } }, now: () => now.t,
  });
  return { store, svc, sent, now };
}
const tokenFrom = (m: EmailMessage) => /set-password\?token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
async function enrolled() {
  const s = setup();
  await s.svc.createAdmin(EMAIL, { apply: true });
  const { token } = await s.svc.setPassword(tokenFrom(s.sent[0]!), 'a long admin passphrase');
  const { secret } = await s.svc.enrolStart(token);
  const { recoveryCodes } = await s.svc.enrolConfirm(token, totpCode(secret, s.now.t));
  return { ...s, secret, recoveryCodes, firstToken: token };
}

// [P46-6c.1 · owner] the service takes the dedicated ADMIN_TOTP_KEY (was the OPS_TOKEN-derived serverSecret)
describe('[P45-1] create-admin', () => {
  it('NEGATIVE: refuses an email not in ADMIN_EMAILS', async () => {
    const { svc, store } = setup();
    await expect(svc.createAdmin('someone@else.io', { apply: true })).rejects.toThrow(/not in ADMIN_EMAILS/);
    expect(store.users.size).toBe(0);
  });
  it('a dry run writes and sends nothing', async () => {
    const { svc, store, sent } = setup();
    expect(await svc.createAdmin(EMAIL, { apply: false })).toMatchObject({ action: 'would_create', email: EMAIL });
    expect(store.users.size).toBe(0);
    expect(sent).toEqual([]);
  });
  it('apply creates the admin and emails the set-password link (the address only, never a rep account)', async () => {
    const { svc, store, sent } = setup();
    expect(await svc.createAdmin(EMAIL, { apply: true })).toMatchObject({ action: 'created', email: EMAIL });
    expect(store.users.size).toBe(1);
    expect(sent[0]).toMatchObject({ to: EMAIL });
    expect(sent[0]!.text).toMatch(/https:\/\/tovira\.io\/admin\/set-password\?token=/);
  });
});

describe('[P45-1] password, 2FA enrolment and login', () => {
  it('set-password: single-use link; the session must enrol 2FA before anything else', async () => {
    const { svc, sent } = setup();
    await svc.createAdmin(EMAIL, { apply: true });
    const t = tokenFrom(sent[0]!);
    const { token } = await svc.setPassword(t, 'a long admin passphrase');
    expect(await svc.stage(token)).toBe('enrol_required');
    await expect(svc.setPassword(t, 'another long passphrase')).rejects.toBeInstanceOf(AdminAuthError);
  });
  it('NEGATIVE: a password under 12 characters is refused', async () => {
    const { svc, sent } = setup();
    await svc.createAdmin(EMAIL, { apply: true });
    await expect(svc.setPassword(tokenFrom(sent[0]!), 'short')).rejects.toThrow(/12 characters/);
  });
  it('enrolment: a correct code completes it and returns 10 one-time recovery codes, stored hashed', async () => {
    const { svc, store, recoveryCodes, firstToken } = await enrolled();
    expect(recoveryCodes).toHaveLength(10);
    for (const c of recoveryCodes) expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(await svc.stage(firstToken)).toBe('ok');
    const u = [...store.users.values()][0]!;
    expect(u.totpSecretEnc).not.toBeNull();
    expect(JSON.stringify([...store.users.values()])).not.toContain(recoveryCodes[0]!);
  });
  it('NEGATIVE: a wrong enrolment code is refused and the account stays unenrolled', async () => {
    const { svc, sent } = setup();
    await svc.createAdmin(EMAIL, { apply: true });
    const { token } = await svc.setPassword(tokenFrom(sent[0]!), 'a long admin passphrase');
    await svc.enrolStart(token);
    await expect(svc.enrolConfirm(token, '000001')).rejects.toBeInstanceOf(AdminAuthError);
    expect(await svc.stage(token)).toBe('enrol_required');
  });
  it('every later login asks for the 6-digit code', async () => {
    const { svc, secret, now } = await enrolled();
    const { token } = await svc.login(EMAIL, 'a long admin passphrase');
    expect(await svc.stage(token)).toBe('mfa_required');
    now.t += 60_000;
    await svc.verifyMfa(token, totpCode(secret, now.t));
    expect(await svc.stage(token)).toBe('ok');
  });
  it('a recovery code works once', async () => {
    const { svc, recoveryCodes } = await enrolled();
    const a = (await svc.login(EMAIL, 'a long admin passphrase')).token;
    await svc.verifyMfa(a, recoveryCodes[0]!);
    expect(await svc.stage(a)).toBe('ok');
    const b = (await svc.login(EMAIL, 'a long admin passphrase')).token;
    await expect(svc.verifyMfa(b, recoveryCodes[0]!)).rejects.toBeInstanceOf(AdminAuthError);
  });
  it('NEGATIVE: the same TOTP code can\'t be used twice (replay)', async () => {
    const { svc, secret, now } = await enrolled();
    now.t += 60_000;
    const code = totpCode(secret, now.t);
    await svc.verifyMfa((await svc.login(EMAIL, 'a long admin passphrase')).token, code);
    await expect(svc.verifyMfa((await svc.login(EMAIL, 'a long admin passphrase')).token, code)).rejects.toBeInstanceOf(AdminAuthError);
  });
  it('NEGATIVE: wrong password and unknown email give the same answer; an email taken out of ADMIN_EMAILS can\'t log in', async () => {
    const { svc, store } = await enrolled();
    const wrong = await svc.login(EMAIL, 'not the passphrase').catch((e) => e.message);
    const unknown = await svc.login('nobody@tovira.io', 'not the passphrase').catch((e) => e.message);
    expect(wrong).toBe(unknown);
    const locked = new AdminAuthService({ store, hasher: new ScryptHasher(), adminEmails: [], totpKey: 'test-admin-totp-key-0123456789', appBaseUrl: 'https://tovira.io' });
    await expect(locked.login(EMAIL, 'a long admin passphrase')).rejects.toBeInstanceOf(AdminAuthError);
  });
});

describe('[P45-1] sessions', () => {
  it('end after 12 hours idle; activity keeps them alive; logout ends them', async () => {
    const { svc, firstToken, now } = await enrolled();
    now.t += 11 * 3_600_000;
    expect(await svc.stage(firstToken)).toBe('ok'); // touched
    now.t += 11 * 3_600_000;
    expect(await svc.stage(firstToken)).toBe('ok');
    now.t += 12 * 3_600_000 + 1;
    expect(await svc.stage(firstToken)).toBeNull();
    const { token } = await svc.login(EMAIL, 'a long admin passphrase');
    await svc.logout(token);
    expect(await svc.stage(token)).toBeNull();
  });
  it('the session token is stored hashed', async () => {
    const { store, firstToken } = await enrolled();
    expect([...store.sessions.keys()]).not.toContain(firstToken);
  });
});
