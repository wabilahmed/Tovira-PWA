import { describe, it, expect, beforeEach } from 'vitest';
import { AccessRequestService, AccessRequestValidationError, type RawAccessRequest } from './access-request-service.js';
import { InMemoryAccessRequestRepository } from '../../adapters/access/in-memory-access-request-repository.js';
import { CONFIRMATION_TEXT_VERSION } from '../legal/versions.js';

const VALID: RawAccessRequest = {
  fullName: 'Dana Rep',
  workEmail: 'dana@brokerage.ae',
  phone: '+971 50 123 4567',
  companyName: 'Meridian Real Estate',
  roleTitle: 'Senior Broker',
  ownership: 'owns_or_manages',
  tradeLicenceNumber: 'TL-998877',
  conversationOwnership: 'brokerage_i_manage',
  conversationOwnershipOther: null,
  expectedVolume: '50_200',
  confirmationAccepted: true,
};

describe('[BETA-3] AccessRequestService.submit validation', () => {
  let repo: InMemoryAccessRequestRepository;
  let service: AccessRequestService;
  const clock = 1_750_000_000_000;
  beforeEach(() => {
    repo = new InMemoryAccessRequestRepository();
    service = new AccessRequestService(repo, () => clock);
  });

  const meta = { sourceIp: '203.0.113.9', userAgent: 'jest' };

  it('accepts a valid owns_or_manages submission and stamps confirmation version + time', async () => {
    const rec = await service.submit(VALID, meta);
    expect(rec.status).toBe('pending');
    expect(rec.tradeLicenceNumber).toBe('TL-998877');
    expect(rec.confirmationAcceptedAt).toBe(clock);
    expect(rec.confirmationTextVersion).toBe(CONFIRMATION_TEXT_VERSION);
    expect(rec.sourceIp).toBe('203.0.113.9');
    expect(rec.userAgent).toBe('jest');
    expect(await repo.count()).toBe(1);
  });

  it('accepts a valid employed submission with no trade licence', async () => {
    const rec = await service.submit({ ...VALID, ownership: 'employed', tradeLicenceNumber: null, conversationOwnership: 'brokerage_employs_me' }, meta);
    expect(rec.ownership).toBe('employed');
    expect(rec.tradeLicenceNumber).toBeNull();
  });

  it('accepts "other" conversation ownership with free text', async () => {
    const rec = await service.submit({ ...VALID, conversationOwnership: 'other', conversationOwnershipOther: 'Clients of a partner firm' }, meta);
    expect(rec.conversationOwnership).toBe('other');
    expect(rec.conversationOwnershipOther).toBe('Clients of a partner firm');
  });

  const rejects = (raw: RawAccessRequest, field: string) =>
    expect(service.submit(raw, meta)).rejects.toMatchObject({ field });

  it('rejects missing/blank required text fields', async () => {
    await rejects({ ...VALID, fullName: '  ' }, 'fullName');
    await rejects({ ...VALID, phone: '' }, 'phone');
    await rejects({ ...VALID, companyName: undefined }, 'companyName');
    await rejects({ ...VALID, roleTitle: '' }, 'roleTitle');
  });

  it('rejects an invalid work email', async () => {
    await rejects({ ...VALID, workEmail: 'not-an-email' }, 'workEmail');
  });

  it('rejects owns_or_manages WITHOUT a trade licence (requiredness is app-owned)', async () => {
    await rejects({ ...VALID, ownership: 'owns_or_manages', tradeLicenceNumber: '' }, 'tradeLicenceNumber');
  });

  it('rejects employed WITH a trade licence (it is only for owns_or_manages)', async () => {
    await rejects({ ...VALID, ownership: 'employed', tradeLicenceNumber: 'TL-1' }, 'tradeLicenceNumber');
  });

  it('rejects "other" without free text, and non-"other" WITH free text', async () => {
    await rejects({ ...VALID, conversationOwnership: 'other', conversationOwnershipOther: '  ' }, 'conversationOwnershipOther');
    await rejects({ ...VALID, conversationOwnership: 'mix', conversationOwnershipOther: 'leaked' }, 'conversationOwnershipOther');
  });

  it('rejects out-of-set enum values', async () => {
    await rejects({ ...VALID, ownership: 'boss' as unknown as RawAccessRequest['ownership'] }, 'ownership');
    await rejects({ ...VALID, conversationOwnership: 'everyone' as unknown as RawAccessRequest['conversationOwnership'] }, 'conversationOwnership');
    await rejects({ ...VALID, expectedVolume: 'loads' as unknown as RawAccessRequest['expectedVolume'] }, 'expectedVolume');
  });

  it('rejects a submission where the confirmation box was not ticked', async () => {
    await rejects({ ...VALID, confirmationAccepted: false }, 'confirmation');
    expect(await repo.count()).toBe(0);
  });

  it('captures an optional referral code, and stores null when absent or malformed', async () => {
    const withRef = await service.submit({ ...VALID, referralCode: 'abc123xyz' }, meta);
    expect(withRef.referralCode).toBe('abc123xyz');
    const noRef = await service.submit({ ...VALID, workEmail: 'other@x.com' }, meta);
    expect(noRef.referralCode).toBeNull();
    const blankRef = await service.submit({ ...VALID, workEmail: 'third@x.com', referralCode: '   ' }, meta);
    expect(blankRef.referralCode).toBeNull();
  });

  it('is a typed validation error (field + message), never a silent pass', async () => {
    await expect(service.submit({ ...VALID, workEmail: 'x' }, meta)).rejects.toBeInstanceOf(AccessRequestValidationError);
  });
});
