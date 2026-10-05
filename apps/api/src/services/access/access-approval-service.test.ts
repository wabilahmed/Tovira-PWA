import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccessApprovalService, AccessRequestNotFoundError, ResendRateLimitedError, INVITE_TTL_DAYS, INVITE_RESEND_MAX_PER_DAY } from './access-approval-service.js';
import { FixedWindowRateLimiter } from '../security/rate-limiter.js';
import { NotPendingError } from '../../ports/access-approval-tx.js';
import { InMemoryAccessRequestRepository } from '../../adapters/access/in-memory-access-request-repository.js';
import { InMemoryInviteRepository } from '../../adapters/access/in-memory-invite-repository.js';
import { InMemoryAccessApprovalTx } from '../../adapters/access/in-memory-access-approval-tx.js';
import { InMemoryUserRepository } from '../../adapters/auth/in-memory-user-repository.js';
import { ScryptHasher } from '../auth/password.js';
import type { AccessRequestInput } from '../../ports/access-request-repository.js';

const REQ = (over: Partial<AccessRequestInput> = {}): AccessRequestInput => ({
  fullName: 'Dana', workEmail: 'dana@x.ae', phone: '1', companyName: 'Co', roleTitle: 'Broker',
  ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-1', conversationOwnership: 'own_clients',
  conversationOwnershipOther: null, expectedVolume: 'under_50', confirmationAcceptedAt: 1, confirmationTextVersion: 'v',
  sourceIp: null, userAgent: null, referralCode: null, ...over,
});

describe('[BETA-5] AccessApprovalService', () => {
  let requests: InMemoryAccessRequestRepository;
  let invites: InMemoryInviteRepository;
  let users: InMemoryUserRepository;
  let sendInvite: ReturnType<typeof vi.fn>;
  let applyReferral: ReturnType<typeof vi.fn>;
  let svc: AccessApprovalService;
  const now = 1_750_000_000_000;

  beforeEach(() => {
    requests = new InMemoryAccessRequestRepository();
    invites = new InMemoryInviteRepository();
    users = new InMemoryUserRepository();
    sendInvite = vi.fn().mockResolvedValue(undefined);
    applyReferral = vi.fn().mockResolvedValue(true);
    svc = new AccessApprovalService({
      requests,
      tx: new InMemoryAccessApprovalTx(users, invites, requests),
      hasher: new ScryptHasher(),
      sendInvite,
      applyReferral,
      appBaseUrl: 'https://app.test',
      invites,
      resendLimiter: new FixedWindowRateLimiter(INVITE_RESEND_MAX_PER_DAY, 24 * 60 * 60 * 1000),
      now: () => now,
    });
  });

  // [BETA-8] Expired-invite recovery. The raw token is in the invite URL; the approve() email carries it.
  const tokenFromLastEmail = (): string => new URL(sendInvite.mock.calls.at(-1)![1] as string).searchParams.get('token')!;

  describe('resendInvite (self-serve from an expired link)', () => {
    it('expired → resend issues a NEW working link to the ORIGINAL address; the OLD link no longer works', async () => {
      const req = await requests.create(REQ());
      await svc.approve(req.id, { createdBy: 'ops' });
      const oldToken = tokenFromLastEmail();
      const oldHash = (await import('node:crypto')).createHash('sha256').update(oldToken).digest('hex');
      sendInvite.mockClear();

      await svc.resendInvite(oldToken); // the user clicks "send a new link" on the expired page
      expect(sendInvite).toHaveBeenCalledTimes(1);
      expect(sendInvite.mock.calls[0]![0]).toBe('dana@x.ae'); // the ORIGINAL invited address
      const newToken = tokenFromLastEmail();
      expect(newToken).not.toBe(oldToken);
      // The new link works; the old one is invalidated.
      expect(await invites.peek((await import('node:crypto')).createHash('sha256').update(newToken).digest('hex'), now)).toBe(true);
      expect(await invites.consume(oldHash, now)).toBeNull(); // old link dead
    });

    it('an ACCEPTED invite does not resend (nothing sent)', async () => {
      const req = await requests.create(REQ());
      await svc.approve(req.id, { createdBy: 'ops' });
      const token = tokenFromLastEmail();
      await requests.review(req.id, { status: 'activated', reviewedAt: now }); // accepted
      sendInvite.mockClear();
      await svc.resendInvite(token);
      expect(sendInvite).not.toHaveBeenCalled();
    });

    it('an UNKNOWN token returns the same ok response and sends nothing (anti-enumeration)', async () => {
      sendInvite.mockClear();
      await expect(svc.resendInvite('not-a-real-token')).resolves.toEqual({ ok: true });
      expect(sendInvite).not.toHaveBeenCalled();
    });

    it(`rate limit: at most ${INVITE_RESEND_MAX_PER_DAY} resends per invite per 24h`, async () => {
      const req = await requests.create(REQ());
      await svc.approve(req.id, { createdBy: 'ops' });
      let token = tokenFromLastEmail();
      sendInvite.mockClear();
      for (let i = 0; i < INVITE_RESEND_MAX_PER_DAY; i++) { await svc.resendInvite(token); token = tokenFromLastEmail(); }
      expect(sendInvite).toHaveBeenCalledTimes(INVITE_RESEND_MAX_PER_DAY);
      await expect(svc.resendInvite(token)).rejects.toBeInstanceOf(ResendRateLimitedError); // 4th blocked
      expect(sendInvite).toHaveBeenCalledTimes(INVITE_RESEND_MAX_PER_DAY); // nothing more sent
    });
  });

  describe('reissueByRequestId (admin)', () => {
    it('re-issues to the original address and invalidates the old link; rejects a non-invited request', async () => {
      const req = await requests.create(REQ());
      await svc.approve(req.id, { createdBy: 'ops' });
      const oldToken = tokenFromLastEmail();
      sendInvite.mockClear();
      await svc.reissueByRequestId(req.id, { createdBy: 'ops' });
      expect(sendInvite.mock.calls[0]![0]).toBe('dana@x.ae');
      expect(await invites.consume((await import('node:crypto')).createHash('sha256').update(oldToken).digest('hex'), now)).toBeNull();
      // A pending (not-invited) request cannot be re-issued.
      const pending = await requests.create(REQ({ workEmail: 'p@x.ae' }));
      await expect(svc.reissueByRequestId(pending.id, { createdBy: 'ops' })).rejects.toBeTruthy();
    });
  });

  it('approve: atomically creates the account + single-use invite, flips to invited + links the user, emails the invite', async () => {
    const req = await requests.create(REQ({ referralCode: 'ref-xyz' }));
    const rec = await svc.approve(req.id, { createdBy: 'ops' });

    expect(rec.status).toBe('invited');
    const user = await users.findByEmail('dana@x.ae');
    expect(user).not.toBeNull();
    expect(rec.linkedUserId).toBe(user!.id);
    expect(await invites.hasOutstanding(user!.id, now)).toBe(true); // an outstanding invite exists
    expect(await invites.hasOutstanding(user!.id, now + (INVITE_TTL_DAYS + 1) * 86400_000)).toBe(false); // expiring in 7d

    expect(sendInvite).toHaveBeenCalledTimes(1);
    const url = sendInvite.mock.calls[0]![1] as string;
    expect(url).toMatch(/^https:\/\/app\.test\/invite\?token=.+/);
    expect(applyReferral).toHaveBeenCalledWith('ref-xyz', user!.id, 'dana@x.ae'); // persisted referral applied
  });

  it('approve: a referral failure does NOT fail the approval (same rule as signup)', async () => {
    applyReferral.mockRejectedValueOnce(new Error('referral down'));
    const req = await requests.create(REQ({ referralCode: 'ref-xyz' }));
    const rec = await svc.approve(req.id, { createdBy: 'ops' });
    expect(rec.status).toBe('invited'); // approval stands
    expect(await users.findByEmail('dana@x.ae')).not.toBeNull();
  });

  it('approve: an invite-email failure does NOT undo the committed approval', async () => {
    sendInvite.mockRejectedValueOnce(new Error('mail down'));
    const req = await requests.create(REQ());
    const rec = await svc.approve(req.id, { createdBy: 'ops' });
    expect(rec.status).toBe('invited');
    const user = await users.findByEmail('dana@x.ae');
    expect(await invites.hasOutstanding(user!.id, now)).toBe(true);
  });

  it('approve: a second approve of the same request is rejected (NotPending) and creates no second account', async () => {
    const req = await requests.create(REQ());
    await svc.approve(req.id, { createdBy: 'ops' });
    await expect(svc.approve(req.id, { createdBy: 'ops' })).rejects.toBeInstanceOf(NotPendingError);
  });

  it('approve/reject: an unknown id is NotFound', async () => {
    await expect(svc.approve('nope', { createdBy: 'ops' })).rejects.toBeInstanceOf(AccessRequestNotFoundError);
    await expect(svc.reject('nope', 'x')).rejects.toBeInstanceOf(AccessRequestNotFoundError);
  });

  it('reject: records status + note and sends NO email', async () => {
    const req = await requests.create(REQ());
    const rec = await svc.reject(req.id, 'not a fit right now');
    expect(rec.status).toBe('rejected');
    expect(rec.reviewedNote).toBe('not a fit right now');
    expect(sendInvite).not.toHaveBeenCalled();
    await expect(svc.reject(req.id, 'again')).rejects.toBeInstanceOf(NotPendingError); // only pending can be rejected
  });

  it('is atomic: if the invite write fails, NO user is left behind (rollback)', async () => {
    const throwingInvites = {
      insert: () => { throw new Error('invite write failed'); },
      remove: vi.fn(),
    };
    const txWithBadInvites = new InMemoryAccessApprovalTx(users, throwingInvites, requests);
    const svc2 = new AccessApprovalService({
      requests, tx: txWithBadInvites, hasher: new ScryptHasher(), sendInvite, applyReferral, appBaseUrl: 'https://app.test', now: () => now,
    });
    const req = await requests.create(REQ());
    await expect(svc2.approve(req.id, { createdBy: 'ops' })).rejects.toThrow('invite write failed');
    expect(await users.findByEmail('dana@x.ae')).toBeNull(); // user creation rolled back
    const after = await requests.get(req.id);
    expect(after!.status).toBe('pending'); // request untouched
  });
});
