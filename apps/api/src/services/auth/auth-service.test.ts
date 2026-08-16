import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService, EmailInUseError, InvalidCredentialsError, AuthValidationError, InvalidResetTokenError, InvalidVerificationTokenError, VerificationRateLimitError, VERIFY_TTL_MS, VERIFY_RESEND_LIMIT } from './auth-service.js';
import { ScryptHasher } from './password.js';
import { InMemoryUserRepository } from '../../adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from '../../adapters/auth/in-memory-session-repository.js';
import { InMemoryPasswordResetRepository } from '../../adapters/auth/in-memory-password-reset-repository.js';
import { InMemoryEmailVerificationRepository } from '../../adapters/auth/in-memory-email-verification-repository.js';

function makeService(opts: { now?: () => number; sessionTtlMs?: number } = {}) {
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const passwordResets = new InMemoryPasswordResetRepository();
  const emailVerifications = new InMemoryEmailVerificationRepository();
  const service = new AuthService({
    users,
    sessions,
    passwordResets,
    emailVerifications,
    hasher: new ScryptHasher(),
    sessionTtlMs: opts.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000,
    now: opts.now,
  });
  return { service, users, sessions, passwordResets, emailVerifications };
}

describe('AuthService', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  // POSITIVE
  it('signs up a new user and issues a session token', async () => {
    const { user, token } = await ctx.service.signup('Rep@Example.com', 'password123');
    expect(user.email).toBe('rep@example.com'); // normalized
    expect(user).not.toHaveProperty('passwordHash'); // never leak the hash
    expect(token).toBeTruthy();
    expect(await ctx.service.authenticate(token)).toEqual({ userId: user.id });
  });

  it('logs in with correct credentials and issues a session', async () => {
    await ctx.service.signup('rep@example.com', 'password123');
    const { user, token } = await ctx.service.login('rep@example.com', 'password123');
    expect(await ctx.service.authenticate(token)).toEqual({ userId: user.id });
  });

  it('keeps the session valid across repeated checks (survives refresh)', async () => {
    const { token, user } = await ctx.service.signup('rep@example.com', 'password123');
    expect(await ctx.service.authenticate(token)).toEqual({ userId: user.id });
    expect(await ctx.service.authenticate(token)).toEqual({ userId: user.id });
  });

  it('invalidates the session on logout', async () => {
    const { token } = await ctx.service.signup('rep@example.com', 'password123');
    await ctx.service.logout(token);
    expect(await ctx.service.authenticate(token)).toBeNull();
  });

  it('logout is idempotent (no throw on an unknown token)', async () => {
    await expect(ctx.service.logout('never-existed')).resolves.toBeUndefined();
  });

  // NEGATIVE — the trust rules
  it('rejects signup with an already-registered email; no duplicate created', async () => {
    await ctx.service.signup('rep@example.com', 'password123');
    await expect(ctx.service.signup('REP@example.com', 'otherpass1')).rejects.toBeInstanceOf(EmailInUseError);
    expect(ctx.users.count()).toBe(1);
  });

  it('rejects signup with an empty email or password', async () => {
    await expect(ctx.service.signup('', 'password123')).rejects.toBeInstanceOf(AuthValidationError);
    await expect(ctx.service.signup('rep@example.com', '')).rejects.toBeInstanceOf(AuthValidationError);
  });

  it('fails login on a wrong password', async () => {
    await ctx.service.signup('rep@example.com', 'password123');
    await expect(ctx.service.login('rep@example.com', 'WRONG')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  // No user enumeration: unknown email and wrong password fail identically.
  it('fails login on an unknown email with the SAME error as a wrong password', async () => {
    await ctx.service.signup('rep@example.com', 'password123');
    const wrongPw = await ctx.service.login('rep@example.com', 'WRONG').catch((e) => e);
    const unknown = await ctx.service.login('nobody@example.com', 'password123').catch((e) => e);
    expect(wrongPw).toBeInstanceOf(InvalidCredentialsError);
    expect(unknown).toBeInstanceOf(InvalidCredentialsError);
    expect((unknown as Error).message).toBe((wrongPw as Error).message);
  });

  it('returns null for an empty, garbage, or logged-out token', async () => {
    expect(await ctx.service.authenticate('')).toBeNull();
    expect(await ctx.service.authenticate('garbage-token')).toBeNull();
  });

  it('treats an expired session as unauthenticated', async () => {
    let clock = 1_000_000;
    const { service } = makeService({ now: () => clock, sessionTtlMs: 1000 });
    const { token } = await service.signup('rep@example.com', 'password123');
    expect(await service.authenticate(token)).not.toBeNull();
    clock += 2000; // advance past the TTL
    expect(await service.authenticate(token)).toBeNull();
  });
});

describe('AuthService — signup consent (P5-4)', () => {
  it('records consent WITH a timestamp and policy version when supplied', async () => {
    const clock = 1_700_000_000_000;
    const { service, users } = makeService({ now: () => clock });
    await service.signup('rep@example.com', 'password123', '2026-08-01');
    const user = await users.findByEmail('rep@example.com');
    expect(user!.consentVersion).toBe('2026-08-01');
    expect(user!.consentAt).toBe(clock);
  });

  it('leaves consent null when none is supplied (non-web clients)', async () => {
    const { service, users } = makeService();
    await service.signup('rep@example.com', 'password123');
    const user = await users.findByEmail('rep@example.com');
    expect(user!.consentAt).toBeNull();
    expect(user!.consentVersion).toBeNull();
  });
});

describe('AuthService — password reset (TASK EMAIL)', () => {
  it('issues a reset token for a known email, and null for an unknown one (no enumeration)', async () => {
    const { service } = makeService();
    await service.signup('rep@example.com', 'password123');
    const known = await service.createPasswordReset('REP@Example.com'); // case-insensitive
    expect(known?.token).toBeTruthy();
    expect(known?.user.email).toBe('rep@example.com');
    expect(await service.createPasswordReset('nobody@example.com')).toBeNull();
  });

  it('resets the password, lets the new one log in, and kills existing sessions', async () => {
    const { service } = makeService();
    const { token: oldSession } = await service.signup('rep@example.com', 'password123');
    const reset = await service.createPasswordReset('rep@example.com');
    await service.resetPassword(reset!.token, 'newpassword1');
    // old session revoked
    expect(await service.authenticate(oldSession)).toBeNull();
    // new password works, old one doesn't
    await expect(service.login('rep@example.com', 'newpassword1')).resolves.toBeTruthy();
    await expect(service.login('rep@example.com', 'password123')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects a reused token (single-use)', async () => {
    const { service } = makeService();
    await service.signup('rep@example.com', 'password123');
    const reset = await service.createPasswordReset('rep@example.com');
    await service.resetPassword(reset!.token, 'newpassword1');
    await expect(service.resetPassword(reset!.token, 'another12')).rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('rejects an expired token', async () => {
    let clock = 1_000_000;
    const { service } = makeService({ now: () => clock });
    await service.signup('rep@example.com', 'password123');
    const reset = await service.createPasswordReset('rep@example.com');
    clock += 61 * 60 * 1000; // past the 60-minute TTL
    await expect(service.resetPassword(reset!.token, 'newpassword1')).rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('rejects a garbage token and a weak password', async () => {
    const { service } = makeService();
    await service.signup('rep@example.com', 'password123');
    await expect(service.resetPassword('not-a-real-token', 'newpassword1')).rejects.toBeInstanceOf(InvalidResetTokenError);
    const reset = await service.createPasswordReset('rep@example.com');
    await expect(service.resetPassword(reset!.token, 'short')).rejects.toBeInstanceOf(AuthValidationError);
  });
});

describe('[EMAIL-VERIFY] soft email verification', () => {
  it('a fresh signup is unverified; verifying with the issued token flips it (banner disappears)', async () => {
    const { service } = makeService();
    const { user } = await service.signup('rep@example.com', 'password1');
    expect(user.emailVerified).toBe(false);
    const token = await service.createEmailVerification(user.id);
    await service.verifyEmail(token);
    const after = await service.getPublicUser(user.id);
    expect(after!.emailVerified).toBe(true);
  });

  it('rejects an EXPIRED token', async () => {
    let clock = 1_000_000;
    const { service } = makeService({ now: () => clock });
    const { user } = await service.signup('rep@example.com', 'password1');
    const token = await service.createEmailVerification(user.id);
    clock += VERIFY_TTL_MS + 1; // one ms past expiry
    await expect(service.verifyEmail(token)).rejects.toBeInstanceOf(InvalidVerificationTokenError);
    expect((await service.getPublicUser(user.id))!.emailVerified).toBe(false);
  });

  it('rejects a REUSED token (single-use)', async () => {
    const { service } = makeService();
    const { user } = await service.signup('rep@example.com', 'password1');
    const token = await service.createEmailVerification(user.id);
    await service.verifyEmail(token); // first use ok
    await expect(service.verifyEmail(token)).rejects.toBeInstanceOf(InvalidVerificationTokenError);
  });

  it("another user's token can never verify a DIFFERENT account", async () => {
    const { service } = makeService();
    const a = (await service.signup('a@example.com', 'password1')).user;
    const b = (await service.signup('b@example.com', 'password1')).user;
    const tokenForA = await service.createEmailVerification(a.id);
    // B presents A's token: it verifies A (the token's owner), NOT B.
    await service.verifyEmail(tokenForA);
    expect((await service.getPublicUser(a.id))!.emailVerified).toBe(true);
    expect((await service.getPublicUser(b.id))!.emailVerified).toBe(false);
  });

  it('rejects an unknown/garbage token', async () => {
    const { service } = makeService();
    await expect(service.verifyEmail('not-a-real-token')).rejects.toBeInstanceOf(InvalidVerificationTokenError);
  });

  it('enforces the resend rate limit server-side (VERIFY_RESEND_LIMIT / UTC day)', async () => {
    const clock = Date.parse('2026-08-16T12:00:00Z');
    const { service } = makeService({ now: () => clock });
    const { user } = await service.signup('rep@example.com', 'password1');
    for (let i = 0; i < VERIFY_RESEND_LIMIT; i++) {
      await expect(service.resendVerification(user.id)).resolves.toEqual(expect.any(String));
    }
    // Budget spent for the day → blocked.
    await expect(service.resendVerification(user.id)).rejects.toBeInstanceOf(VerificationRateLimitError);
  });

  it('the daily resend budget resets the next UTC day', async () => {
    let clock = Date.parse('2026-08-16T23:00:00Z');
    const { service } = makeService({ now: () => clock });
    const { user } = await service.signup('rep@example.com', 'password1');
    for (let i = 0; i < VERIFY_RESEND_LIMIT; i++) await service.resendVerification(user.id);
    await expect(service.resendVerification(user.id)).rejects.toBeInstanceOf(VerificationRateLimitError);
    clock = Date.parse('2026-08-17T00:30:00Z'); // next UTC day
    await expect(service.resendVerification(user.id)).resolves.toEqual(expect.any(String));
  });

  it('a resent token verifies the account', async () => {
    const { service } = makeService();
    const { user } = await service.signup('rep@example.com', 'password1');
    const token = await service.resendVerification(user.id);
    await service.verifyEmail(token);
    expect((await service.getPublicUser(user.id))!.emailVerified).toBe(true);
  });
});
