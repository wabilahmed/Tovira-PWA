import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService, EmailInUseError, InvalidCredentialsError, AuthValidationError } from './auth-service.js';
import { ScryptHasher } from './password.js';
import { InMemoryUserRepository } from '../../adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from '../../adapters/auth/in-memory-session-repository.js';

function makeService(opts: { now?: () => number; sessionTtlMs?: number } = {}) {
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const service = new AuthService({
    users,
    sessions,
    hasher: new ScryptHasher(),
    sessionTtlMs: opts.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000,
    now: opts.now,
  });
  return { service, users, sessions };
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
