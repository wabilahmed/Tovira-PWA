import { describe, it, expect } from 'vitest';
import { planBackfill, type AccountState } from './backfill-trials.js';

// [P15] The backfill's eligibility decision is a PURE function (the SQL fetch + transactional insert are
// validated live per [[migrations-only-validated-live]]). These lock the four rules the owner asked for.
const acct = (over: Partial<AccountState> = {}): AccountState => ({
  id: 'u-normal', email: 'rep@company.ae', createdAt: '2026-09-01T00:00:00Z',
  acceptedAt: '2026-09-02T00:00:00Z', hasSubscription: false, ...over,
});

describe('[P15] planBackfill — who gets a backfilled trial', () => {
  it('EXCLUDES a pending invite (approved but never accepted → terms_accepted_at null)', () => {
    const plan = planBackfill([acct({ id: 'pending', acceptedAt: null })], { excludeUserIds: new Set(), excludeEmails: new Set() });
    expect(plan.included).toEqual([]);
    expect(plan.excluded).toHaveLength(1);
    expect(plan.excluded[0]!.reason).toMatch(/pending invite/i);
    expect(plan.excluded[0]!.account.id).toBe('pending');
  });

  it('INCLUDES an accepted account with no subscription', () => {
    const plan = planBackfill([acct({ id: 'good' })], { excludeUserIds: new Set(), excludeEmails: new Set() });
    expect(plan.excluded).toEqual([]);
    expect(plan.included).toHaveLength(1);
    expect(plan.included[0]!.account.id).toBe('good');
  });

  it('EXCLUDES an ops/test account by the explicit list — but INCLUDES it when named with --only', () => {
    const ops = acct({ id: 'test-rep', email: 'wabil+rep@prospera-technologies.com' });
    // normal run: excluded by the explicit id list
    const normal = planBackfill([ops], { excludeUserIds: new Set(['test-rep']), excludeEmails: new Set() });
    expect(normal.included).toEqual([]);
    expect(normal.excluded[0]!.reason).toMatch(/ops\/test\/seed/i);
    // excluded by the explicit EMAIL list too (operator thinks in emails)
    const byEmail = planBackfill([ops], { excludeUserIds: new Set(), excludeEmails: new Set(['wabil+rep@prospera-technologies.com']) });
    expect(byEmail.excluded[0]!.reason).toMatch(/ops\/test\/seed/i);
    // --only names it: the exclusion is bypassed and it is included
    const only = planBackfill([ops], { excludeUserIds: new Set(['test-rep']), excludeEmails: new Set(), onlyUserId: 'test-rep' });
    expect(only.included).toHaveLength(1);
    expect(only.included[0]!.account.id).toBe('test-rep');
    expect(only.included[0]!.reason).toMatch(/only/i);
  });

  it('is idempotent: a second run is a no-op — an account that already has a subscription is excluded', () => {
    const plan = planBackfill([acct({ id: 'already', hasSubscription: true })], { excludeUserIds: new Set(), excludeEmails: new Set() });
    expect(plan.included).toEqual([]);
    expect(plan.excluded[0]!.reason).toMatch(/already has a subscription/i);
  });

  it('--only NEVER double-grants or trials a pending account, even when named (idempotency + accept rule hold)', () => {
    const subbed = planBackfill([acct({ id: 'x', hasSubscription: true })], { excludeUserIds: new Set(), excludeEmails: new Set(), onlyUserId: 'x' });
    expect(subbed.included).toEqual([]);
    expect(subbed.excluded[0]!.reason).toMatch(/already has a subscription/i);
    const pending = planBackfill([acct({ id: 'y', acceptedAt: null })], { excludeUserIds: new Set(), excludeEmails: new Set(), onlyUserId: 'y' });
    expect(pending.included).toEqual([]);
    expect(pending.excluded[0]!.reason).toMatch(/pending invite/i);
  });

  it('--only ignores every account except the named one', () => {
    const plan = planBackfill([acct({ id: 'a' }), acct({ id: 'b' })], { excludeUserIds: new Set(), excludeEmails: new Set(), onlyUserId: 'a' });
    expect(plan.included).toHaveLength(1);
    expect(plan.included[0]!.account.id).toBe('a');
    expect(plan.excluded.find((e) => e.account.id === 'b')!.reason).toMatch(/not named by --only/i);
  });
});
