import { createHash, randomBytes } from 'node:crypto';
import type { AdminStore, AdminUser } from '../../ports/admin.js';
import type { EmailSender } from '../../ports/email.js';
import { DUMMY_VERIFY_HASH, type PasswordHasher } from '../auth/password.js';
import { SecretBox } from './secret-box.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp.js';

/**
 * [P45-1 · owner] Admin authentication: Tovira's operator console, never a rep.
 *
 *  - Only emails in ADMIN_EMAILS (config) can be created or log in. The account is created by the create-admin
 *    script, which emails a single-use set-password link (7 days).
 *  - 2FA is required: TOTP enrolled on first login (after the password), asked at every login after. Ten one-time
 *    recovery codes are shown once at enrolment and stored hashed.
 *  - A session that hasn't completed 2FA can only enrol or verify. Sessions end after 12 hours without activity;
 *    logout ends them. Tokens are stored hashed.
 */
export class AdminAuthError extends Error {
  constructor(message: string, readonly code: 'invalid' | 'mfa' | 'expired' | 'forbidden' | 'weak_password' = 'invalid') {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export type AdminStage = 'enrol_required' | 'mfa_required' | 'ok';
export const ADMIN_SESSION_IDLE_MS = 12 * 3_600_000;
const INVITE_TTL_MS = 7 * 24 * 3_600_000;
const MIN_PASSWORD = 12;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');
/** "abcd-efgh-ijkl": 60 bits each, easy to type from paper. */
const newRecoveryCode = (): string => randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 12).toLowerCase().replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');

export interface AdminAuthDeps {
  store: AdminStore;
  hasher: PasswordHasher;
  /** ADMIN_EMAILS, lower-cased. */
  adminEmails: string[];
  /** A server secret NOT in the database (OPS_TOKEN): encrypts TOTP secrets. Null → admin 2FA can't run (refused). */
  serverSecret: string | null;
  appBaseUrl: string;
  email?: EmailSender;
  now?: () => number;
}

export class AdminAuthService {
  private readonly now: () => number;
  constructor(private readonly deps: AdminAuthDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  isAdminEmail(email: string): boolean {
    return this.deps.adminEmails.includes(email.trim().toLowerCase());
  }

  private box(): SecretBox {
    if (!this.deps.serverSecret) throw new AdminAuthError('Admin sign-in is not configured.', 'forbidden');
    return new SecretBox(this.deps.serverSecret);
  }

  /** [create-admin] Dry run by default. Creates the admin (if new) and emails a single-use set-password link. */
  async createAdmin(rawEmail: string, opts: { apply: boolean }): Promise<{ action: 'would_create' | 'created' | 'would_reinvite' | 'reinvited' | 'already_set_up'; email: string }> {
    const email = rawEmail.trim().toLowerCase();
    if (!this.isAdminEmail(email)) throw new AdminAuthError(`${email} is not in ADMIN_EMAILS.`, 'forbidden');
    const existing = await this.deps.store.findUserByEmail(email);
    if (existing?.passwordHash) return { action: 'already_set_up', email };
    if (!opts.apply) return { action: existing ? 'would_reinvite' : 'would_create', email };
    const user = existing ?? (await this.deps.store.createUser(email, this.now()));
    const token = newToken();
    await this.deps.store.createInvite(sha256(token), user.id, this.now() + INVITE_TTL_MS);
    if (!this.deps.email) throw new Error('email is not configured');
    await this.deps.email.send({
      to: email,
      subject: 'Set your Tovira admin password',
      text: [
        'Your Tovira admin account is ready.',
        '',
        `Set your password: ${this.deps.appBaseUrl}/admin/set-password?token=${token}`,
        '',
        'The link works once and expires in 7 days. After setting the password you will add an authenticator app (two-factor).',
      ].join('\n'),
    });
    await this.deps.store.audit({ adminEmail: 'create-admin script', action: existing ? 'admin.reinvited' : 'admin.created', target: email, detail: null, at: this.now() });
    return { action: existing ? 'reinvited' : 'created', email };
  }

  private async startSession(adminId: string, mfaOk: boolean): Promise<string> {
    const token = newToken();
    const at = this.now();
    await this.deps.store.createSession({ tokenHash: sha256(token), adminId, mfaOk, lastSeenAt: at, createdAt: at });
    return token;
  }

  async setPassword(inviteToken: string, password: string): Promise<{ token: string }> {
    if (!password || password.length < MIN_PASSWORD) throw new AdminAuthError(`The password needs at least ${MIN_PASSWORD} characters.`, 'weak_password');
    const adminId = await this.deps.store.consumeInvite(sha256(inviteToken), this.now());
    if (!adminId) throw new AdminAuthError('This link is no longer valid.', 'expired');
    const user = await this.deps.store.findUserById(adminId);
    if (!user || !this.isAdminEmail(user.email)) throw new AdminAuthError('This link is no longer valid.', 'expired');
    await this.deps.store.updateUser(adminId, { passwordHash: await this.deps.hasher.hash(password) });
    return { token: await this.startSession(adminId, false) };
  }

  /** Same answer for an unknown email and a wrong password (and the same scrypt cost). */
  async login(rawEmail: string, password: string): Promise<{ token: string }> {
    const email = rawEmail.trim().toLowerCase();
    const user = this.isAdminEmail(email) ? await this.deps.store.findUserByEmail(email) : null;
    const ok = await this.deps.hasher.verify(password ?? '', user?.passwordHash ?? DUMMY_VERIFY_HASH);
    if (!user || !user.passwordHash || !ok) throw new AdminAuthError('Email or password is not right.');
    await this.deps.store.audit({ adminEmail: email, action: 'admin.sign_in_password', target: null, detail: null, at: this.now() });
    return { token: await this.startSession(user.id, false) };
  }

  /** The session's admin and stage, or null (missing, or idle past 12 hours → removed). Touches it. */
  async session(token: string): Promise<{ admin: AdminUser; stage: AdminStage; tokenHash: string } | null> {
    if (!token) return null;
    const tokenHash = sha256(token);
    const s = await this.deps.store.findSession(tokenHash);
    if (!s) return null;
    const now = this.now();
    if (now - s.lastSeenAt > ADMIN_SESSION_IDLE_MS) { await this.deps.store.deleteSession(tokenHash); return null; }
    const admin = await this.deps.store.findUserById(s.adminId);
    if (!admin || !this.isAdminEmail(admin.email)) { await this.deps.store.deleteSession(tokenHash); return null; }
    await this.deps.store.touchSession(tokenHash, now);
    const stage: AdminStage = s.mfaOk ? 'ok' : admin.totpEnrolledAt ? 'mfa_required' : 'enrol_required';
    return { admin, stage, tokenHash };
  }

  async stage(token: string): Promise<AdminStage | null> {
    return (await this.session(token))?.stage ?? null;
  }

  /** Start enrolment: a new secret (shown once, as text and an otpauth link). Only before 2FA is set up. */
  async enrolStart(token: string): Promise<{ secret: string; otpauthUrl: string }> {
    const s = await this.session(token);
    if (!s || s.stage !== 'enrol_required') throw new AdminAuthError('Two-factor is already set up.', 'forbidden');
    const secret = generateTotpSecret();
    await this.deps.store.updateUser(s.admin.id, { totpPendingEnc: this.box().seal(secret) });
    return { secret, otpauthUrl: otpauthUrl(secret, s.admin.email) };
  }

  /** Confirm enrolment with a code from the app: 2FA on, this session done, 10 recovery codes (shown once). */
  async enrolConfirm(token: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const s = await this.session(token);
    if (!s || s.stage !== 'enrol_required' || !s.admin.totpPendingEnc) throw new AdminAuthError('Start two-factor setup first.', 'forbidden');
    const secret = this.box().open(s.admin.totpPendingEnc);
    const step = verifyTotp(secret, String(code ?? '').trim(), this.now());
    if (step === null) throw new AdminAuthError('That code is not right. Check the time on your phone and try again.', 'mfa');
    const codes = Array.from({ length: 10 }, newRecoveryCode);
    await this.deps.store.updateUser(s.admin.id, { totpSecretEnc: s.admin.totpPendingEnc, totpPendingEnc: null, totpEnrolledAt: this.now(), totpLastStep: step });
    await this.deps.store.replaceRecoveryCodes(s.admin.id, codes.map(sha256));
    await this.deps.store.markSessionMfa(s.tokenHash);
    await this.deps.store.audit({ adminEmail: s.admin.email, action: 'admin.2fa_enrolled', target: null, detail: null, at: this.now() });
    return { recoveryCodes: codes };
  }

  /** The second factor at login: a 6-digit code (never the same step twice) or an unused recovery code. */
  async verifyMfa(token: string, rawCode: string): Promise<void> {
    const s = await this.session(token);
    if (!s || s.stage !== 'mfa_required' || !s.admin.totpSecretEnc) throw new AdminAuthError('Sign in again.', 'forbidden');
    const code = String(rawCode ?? '').trim().toLowerCase();
    let how: 'totp' | 'recovery' | null = null;
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(this.box().open(s.admin.totpSecretEnc), code, this.now(), s.admin.totpLastStep);
      if (step !== null) { await this.deps.store.updateUser(s.admin.id, { totpLastStep: step }); how = 'totp'; }
    } else if (await this.deps.store.useRecoveryCode(s.admin.id, sha256(code), this.now())) {
      how = 'recovery';
    }
    if (!how) throw new AdminAuthError('That code is not right.', 'mfa');
    await this.deps.store.markSessionMfa(s.tokenHash);
    await this.deps.store.audit({ adminEmail: s.admin.email, action: how === 'totp' ? 'admin.sign_in' : 'admin.sign_in_recovery_code', target: null, detail: null, at: this.now() });
  }

  async logout(token: string): Promise<void> {
    if (token) await this.deps.store.deleteSession(sha256(token));
  }
}
