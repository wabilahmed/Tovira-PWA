import { describe, it, expect, beforeEach } from 'vitest';
import { AccessRequestRetentionService, ACCESS_REQUEST_RETENTION_DAYS } from './access-request-retention.js';
import { InMemoryAccessRequestRepository } from '../../adapters/access/in-memory-access-request-repository.js';
import type { AccessRequestInput, AccessRequestStatus } from '../../ports/access-request-repository.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const base = (): AccessRequestInput => ({
  fullName: 'X', workEmail: 'x@x.ae', phone: '1', companyName: 'Co', roleTitle: 'R',
  ownership: 'employed', tradeLicenceNumber: null, conversationOwnership: 'brokerage_employs_me',
  conversationOwnershipOther: null, expectedVolume: 'under_50', confirmationAcceptedAt: 1, confirmationTextVersion: 'v',
  sourceIp: null, userAgent: null, referralCode: null,
});

describe('[BETA-8] access-request retention sweep', () => {
  let repo: InMemoryAccessRequestRepository;
  let svc: AccessRequestRetentionService;

  // Seed a request with a specific age + status (reaching past the public create() to set createdAt/status).
  async function seed(ageDays: number, status: AccessRequestStatus): Promise<string> {
    const r = await repo.create(base());
    (r as { createdAt: number }).createdAt = NOW - ageDays * DAY;
    (r as { status: AccessRequestStatus }).status = status;
    return r.id;
  }

  beforeEach(() => {
    repo = new InMemoryAccessRequestRepository();
    svc = new AccessRequestRetentionService(repo, () => NOW);
  });

  it(`deletes rejected and pending requests older than ${ACCESS_REQUEST_RETENTION_DAYS}d, keeps recent ones`, async () => {
    const oldPending = await seed(ACCESS_REQUEST_RETENTION_DAYS + 1, 'pending');
    const oldRejected = await seed(ACCESS_REQUEST_RETENTION_DAYS + 5, 'rejected');
    const freshPending = await seed(ACCESS_REQUEST_RETENTION_DAYS - 1, 'pending');

    const deleted = await svc.sweep(NOW);
    expect(deleted).toBe(2);
    expect(await repo.get(oldPending)).toBeNull();
    expect(await repo.get(oldRejected)).toBeNull();
    expect(await repo.get(freshPending)).not.toBeNull(); // not yet old enough
  });

  it('NEVER deletes approved/invited/activated requests, however old (they are the authority record)', async () => {
    const approved = await seed(ACCESS_REQUEST_RETENTION_DAYS + 100, 'approved');
    const invited = await seed(ACCESS_REQUEST_RETENTION_DAYS + 100, 'invited');
    const activated = await seed(ACCESS_REQUEST_RETENTION_DAYS + 100, 'activated');

    const deleted = await svc.sweep(NOW);
    expect(deleted).toBe(0);
    for (const id of [approved, invited, activated]) expect(await repo.get(id)).not.toBeNull();
  });
});
