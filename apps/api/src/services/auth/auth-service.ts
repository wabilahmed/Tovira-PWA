import { randomBytes, createHash } from 'node:crypto';
import type { UserRepository, UserRecord } from '../../ports/user-repository.js';
import type { SessionRepository } from '../../ports/session-repository.js';
import type { PasswordResetRepository } from '../../ports/password-reset-repository.js';
import type { EmailVerificationRepository } from '../../ports/email-verification-repository.js';
import type { PasswordHasher } from './password.js';

export class AuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export class AuthValidationError extends AuthError {
  override name = 'AuthValidationError';
  constructor(message: string) {
    super(400, message);
  }
}
export class EmailInUseError extends AuthError {
  override name = 'EmailInUseError';
  constructor() {
    super(409, 'That email is already registered.');
  }
}
export class InvalidCredentialsError extends AuthError {
  override name = 'InvalidCredentialsError';
  constructor() {
    // Deliberately generic — must NOT reveal whether the email exists.
    super(401, 'Invalid email or password.');
  }
}

export interface PublicUser {
  id: string;
  email: string;
  /** Opaque code for the share/referral link — never the raw user id (P5-6). */
  referralCode: string;
  /** Soft email verification (EMAIL-VERIFY) — NEVER gates access; only drives the
   *  quiet in-app "confirm your email" banner and the Settings verified state. */
  emailVerified: boolean;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
  expiresAt: number;
}

export interface Identity {
  userId: string;
}

export class InvalidResetTokenError extends AuthError {
  override name = 'InvalidResetTokenError';
  constructor() {
    // Generic — expired / reused / unknown all look identical (no oracle).
    super(400, 'This reset link is invalid or has expired. Request a new one.');
  }
}

export class InvalidVerificationTokenError extends AuthError {
  override name = 'InvalidVerificationTokenError';
  constructor() {
    // Generic — expired / reused / another user's token all look identical.
    super(400, 'This verification link is invalid or has expired. Request a new one.');
  }
}

export class VerificationRateLimitError extends AuthError {
  override name = 'VerificationRateLimitError';
  constructor() {
    super(429, "You've asked for too many verification emails today. Try again tomorrow.");
  }
}

export interface AuthServiceDeps {
  users: UserRepository;
  sessions: SessionRepository;
  passwordResets: PasswordResetRepository;
  emailVerifications: EmailVerificationRepository;
  hasher: PasswordHasher;
  sessionTtlMs: number;
  now?: () => number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Password-reset tokens live for one hour. */
export const RESET_TTL_MS = 60 * 60 * 1000;
/** Email-verification tokens live for seven days (EMAIL-VERIFY). */
export const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many verification emails per user per calendar day (UTC) — the
 *  server-enforced resend rate limit. Counts the signup token too. */
export const VERIFY_RESEND_LIMIT = 3;
/** The current Terms/Privacy version a signup agrees to (P5-4). Bump on change. */
export const CONSENT_POLICY_VERSION = '2026-08-01';
const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export class AuthService {
  private readonly deps: AuthServiceDeps;
  private readonly now: () => number;

  constructor(deps: AuthServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Create an account. When the caller supplies a `consentVersion` (the web
   * always does — see the route), it is stored WITH a timestamp against the
   * user (P5-4), so consent is auditable ("agreed to <version> at <time>").
   */
  async signup(emailRaw: string, password: string, consentVersion?: string): Promise<AuthResult> {
    const email = normalizeEmail(emailRaw);
    if (!EMAIL_RE.test(email)) throw new AuthValidationError('A valid email is required.');
    if (!password || password.length < 8) {
      throw new AuthValidationError('Password must be at least 8 characters.');
    }
    if (await this.deps.users.findByEmail(email)) throw new EmailInUseError();

    const passwordHash = await this.deps.hasher.hash(password);
    // An opaque, urlsafe referral code — the share link carries this, not the id.
    const referralCode = randomBytes(6).toString('base64url');
    const user = await this.deps.users.create({
      email,
      passwordHash,
      referralCode,
      ...(consentVersion ? { consentAt: this.now(), consentVersion } : {}),
    });
    return this.issue(user);
  }

  async login(emailRaw: string, password: string): Promise<AuthResult> {
    const email = normalizeEmail(emailRaw);
    const user = await this.deps.users.findByEmail(email);
    // Always run a verify (even on unknown email) to avoid a timing oracle, and
    // fail with one generic error for both cases — no user enumeration.
    const ok = await this.deps.hasher.verify(password, user?.passwordHash ?? 'scrypt$00$00');
    if (!user || !ok) throw new InvalidCredentialsError();
    return this.issue(user);
  }

  async authenticate(token: string): Promise<Identity | null> {
    if (!token) return null;
    const session = await this.deps.sessions.find(token);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      await this.deps.sessions.delete(token);
      return null;
    }
    return { userId: session.userId };
  }

  async logout(token: string): Promise<void> {
    if (token) await this.deps.sessions.delete(token);
  }

  async deleteUser(userId: string): Promise<void> {
    await this.deps.users.delete(userId);
  }

  /** All user ids — drives the nightly priorities precompute (P4b-3). */
  async allUserIds(): Promise<string[]> {
    return this.deps.users.listAllIds();
  }

  async getPublicUser(userId: string): Promise<PublicUser | null> {
    const user = await this.deps.users.findById(userId);
    return user ? { id: user.id, email: user.email, referralCode: user.referralCode, emailVerified: user.emailVerified } : null;
  }

  /**
   * Begin a password reset (TASK EMAIL). Returns the RAW token + the user when
   * the email has an account, else null — the ROUTE responds 200 either way (no
   * user enumeration). The caller emails the token; only its hash is stored.
   */
  async createPasswordReset(emailRaw: string): Promise<{ user: PublicUser; token: string } | null> {
    const email = normalizeEmail(emailRaw);
    const user = await this.deps.users.findByEmail(email);
    if (!user) return null;
    const token = randomBytes(32).toString('base64url');
    await this.deps.passwordResets.create({ tokenHash: hashToken(token), userId: user.id, expiresAt: this.now() + RESET_TTL_MS });
    return { user: { id: user.id, email: user.email, referralCode: user.referralCode, emailVerified: user.emailVerified }, token };
  }

  /**
   * Complete a reset: validate the new password, set it, then INVALIDATE — every
   * session revoked, every reset token for the user cleared (single-use +
   * password-change invalidation). Throws on a bad token or weak password.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new AuthValidationError('Password must be at least 8 characters.');
    }
    const userId = await this.deps.passwordResets.consume(hashToken(rawToken), this.now());
    if (!userId) throw new InvalidResetTokenError();
    const passwordHash = await this.deps.hasher.hash(newPassword);
    await this.deps.users.updatePassword(userId, passwordHash);
    await this.deps.sessions.deleteByUser(userId); // every existing session dies
    await this.deps.passwordResets.deleteForUser(userId); // and any other outstanding tokens
  }

  /**
   * Issue a single-use email-verification token (EMAIL-VERIFY). Returns the RAW
   * token — the caller puts it in the welcome/resend email link; only its hash is
   * stored. Never gates anything; verification is soft.
   */
  async createEmailVerification(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    await this.deps.emailVerifications.create({
      tokenHash: hashToken(token),
      userId,
      expiresAt: now + VERIFY_TTL_MS,
      createdAt: now,
    });
    return token;
  }

  /**
   * Consume a verification token and mark the user verified. Throws
   * InvalidVerificationTokenError when the token is expired, already used, or
   * unknown (another user's token consumes to their own id — it can never verify
   * a different account).
   */
  async verifyEmail(rawToken: string): Promise<void> {
    const userId = await this.deps.emailVerifications.consume(hashToken(rawToken), this.now());
    if (!userId) throw new InvalidVerificationTokenError();
    await this.deps.users.markEmailVerified(userId);
  }

  /**
   * Re-issue a verification token, server-side rate-limited to
   * VERIFY_RESEND_LIMIT per user per UTC day. Returns the raw token to email, or
   * throws VerificationRateLimitError once the day's budget is spent.
   */
  async resendVerification(userId: string): Promise<string> {
    const now = this.now();
    const d = new Date(now);
    const startOfDayUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const usedToday = await this.deps.emailVerifications.countCreatedSince(userId, startOfDayUtc);
    if (usedToday >= VERIFY_RESEND_LIMIT) throw new VerificationRateLimitError();
    return this.createEmailVerification(userId);
  }

  /** Resolve an opaque referral code to its user id (P5-6), or null. */
  async findUserIdByReferralCode(code: string): Promise<string | null> {
    const user = await this.deps.users.findByReferralCode(code);
    return user?.id ?? null;
  }

  get sessionTtlSeconds(): number {
    return Math.floor(this.deps.sessionTtlMs / 1000);
  }

  private async issue(user: UserRecord): Promise<AuthResult> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + this.deps.sessionTtlMs;
    await this.deps.sessions.create({ token, userId: user.id, expiresAt });
    return { user: { id: user.id, email: user.email, referralCode: user.referralCode, emailVerified: user.emailVerified }, token, expiresAt };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
