import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { AuthService, AuthValidationError, InvalidInviteTokenError } from './auth-service.js';
import { ScryptHasher } from './password.js';
import { InMemoryUserRepository } from '../../adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from '../../adapters/auth/in-memory-session-repository.js';
import { InMemoryPasswordResetRepository } from '../../adapters/auth/in-memory-password-reset-repository.js';
import { InMemoryEmailVerificationRepository } from '../../adapters/auth/in-memory-email-verification-repository.js';
import { InMemoryInviteRepository } from '../../adapters/access/in-memory-invite-repository.js';
import { InMemoryAccessRequestRepository } from '../../adapters/access/in-memory-access-request-repository.js';
import { InMemoryInviteActivationTx } from '../../adapters/access/in-memory-invite-activation-tx.js';
import type { AccessRequestInput } from '../../ports/access-request-repository.js';

const hash = (raw: string): string => createHash('sha256').update(raw).digest('hex');
const now = 1_750_000_000_000;
const DAY = 86_400_000;

const REQ: AccessRequestInput = {
  fullName: 'Dana', workEmail: 'dana@x.ae', phone: '1', companyName: 'Co', roleTitle: 'Broker',
  ownership: 'owns_or_manages', tradeLicenceNumber: 'TL', conversationOwnership: 'own_clients',
  conversationOwnershipOther: null, expectedVolume: 'under_50', confirmationAcceptedAt: 1, confirmationTextVersion: 'v',
  sourceIp: null, userAgent: null, referralCode: null,
};

describe('[BETA-6] AuthService.acceptInvite', () => {
  let users: InMemoryUserRepository;
  let invites: InMemoryInviteRepository;
  let requests: InMemoryAccessRequestRepository;
  let auth: AuthService;
  let userId: string;
  let requestId: string;

  async function seedInvite(rawToken: string, expiresAt: number): Promise<void> {
    const user = await users.create({ email: 'dana@x.ae', passwordHash: 'scrypt$unusable', referralCode: `rc-${rawToken}` });
    userId = user.id;
    const req = await requests.create(REQ);
    requestId = req.id;
    await requests.review(req.id, { status: 'invited', reviewedAt: now, linkedUserId: user.id });
    invites.insert({ tokenHash: hash(rawToken), accessRequestId: req.id, userId: user.id, expiresAt, createdBy: 'ops' });
  }

  beforeEach(() => {
    users = new InMemoryUserRepository();
    invites = new InMemoryInviteRepository();
    requests = new InMemoryAccessRequestRepository();
    auth = new AuthService({
      users,
      sessions: new InMemorySessionRepository(),
      passwordResets: new InMemoryPasswordResetRepository(),
      emailVerifications: new InMemoryEmailVerificationRepository(),
      hasher: new ScryptHasher(),
      sessionTtlMs: 60 * 60 * 1000,
      invites,
      inviteActivation: new InMemoryInviteActivationTx(invites, users, requests),
      now: () => now,
    });
  });

  it('rejects an UNKNOWN token', async () => {
    await seedInvite('good', now + 7 * DAY);
    await expect(auth.acceptInvite('never-issued', 'password123', '2026-09-22', '1.2.3.4')).rejects.toBeInstanceOf(InvalidInviteTokenError);
  });

  it('rejects an EXPIRED token', async () => {
    await seedInvite('expired', now - DAY);
    await expect(auth.acceptInvite('expired', 'password123', '2026-09-22', '1.2.3.4')).rejects.toBeInstanceOf(InvalidInviteTokenError);
  });

  it('rejects an ALREADY-CONSUMED token (the link cannot be used twice)', async () => {
    await seedInvite('once', now + 7 * DAY);
    await auth.acceptInvite('once', 'password123', '2026-09-22', '1.2.3.4');
    await expect(auth.acceptInvite('once', 'password123', '2026-09-22', '1.2.3.4')).rejects.toBeInstanceOf(InvalidInviteTokenError);
  });

  it('VALID token: sets the password, records terms (version/time/ip), activates the request, burns the invite', async () => {
    await seedInvite('valid', now + 7 * DAY);
    const { userId: uid } = await auth.acceptInvite('valid', 'password123', '2026-09-22', '203.0.113.9');
    expect(uid).toBe(userId);
    const user = await users.findById(userId);
    expect(await new ScryptHasher().verify('password123', user!.passwordHash)).toBe(true); // password now set
    expect(user!.termsVersionAccepted).toBe('2026-09-22');
    expect(user!.termsAcceptedAt).toBe(now);
    expect(user!.termsAcceptedIp).toBe('203.0.113.9');
    expect((await requests.get(requestId))!.status).toBe('activated');
    expect(await auth.peekInvite('valid')).toBe(false); // consumed
  });

  it('enforces the existing password policy (min 8) and does NOT consume the invite on a reject', async () => {
    await seedInvite('short', now + 7 * DAY);
    await expect(auth.acceptInvite('short', 'short', '2026-09-22', '1.2.3.4')).rejects.toBeInstanceOf(AuthValidationError);
    expect(await auth.peekInvite('short')).toBe(true); // still usable — nothing was consumed
  });

  it('is single-use under CONCURRENCY: two simultaneous accepts → exactly one succeeds', async () => {
    await seedInvite('race', now + 7 * DAY);
    const results = await Promise.allSettled([
      auth.acceptInvite('race', 'password123', '2026-09-22', '1.1.1.1'),
      auth.acceptInvite('race', 'password123', '2026-09-22', '2.2.2.2'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidInviteTokenError);
    expect(await auth.peekInvite('race')).toBe(false);
  });

  it('peekInvite reflects validity without consuming', async () => {
    await seedInvite('peek', now + 7 * DAY);
    expect(await auth.peekInvite('peek')).toBe(true);
    expect(await auth.peekInvite('peek')).toBe(true); // peeking never burns it
    expect(await auth.peekInvite('nope')).toBe(false);
  });
});
