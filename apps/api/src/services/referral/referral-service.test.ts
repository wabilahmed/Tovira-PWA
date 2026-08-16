import { describe, it, expect, vi } from 'vitest';
import { ReferralService } from './referral-service.js';
import { InMemoryReferralRepository } from '../../adapters/referral/in-memory-referral-repository.js';

// The referral code is OPAQUE — apply() resolves it to a referrer id via this
// function (a user lookup in production), never trusts a raw id off the URL.
function make(resolve: (code: string) => Promise<string | null> = async (c) => (c ? c : null)) {
  const repo = new InMemoryReferralRepository();
  const granted: string[] = [];
  const grantor = { grantReferralMonth: vi.fn(async (id: string) => { granted.push(id); return true; }) };
  return { svc: new ReferralService(repo, grantor, resolve), granted, grantor };
}

describe('ReferralService (P5-6)', () => {
  it('credits BOTH the referrer and the referred, exactly once', async () => {
    const { svc, granted } = make();
    expect(await svc.apply('referrer', 'newUser', 'new@example.com')).toBe(true);
    expect(granted).toEqual(['referrer', 'newUser']);
  });

  // ANTI-FARMING: you can't refer yourself.
  it('rejects self-referral', async () => {
    const { svc, granted } = make();
    expect(await svc.apply('me', 'me', 'me@example.com')).toBe(false);
    expect(granted).toEqual([]);
  });

  // ANTI-FARMING: the same person can't be referred twice.
  it('rejects repeat referral of the same person', async () => {
    const { svc } = make();
    expect(await svc.apply('r1', 'u1', 'dup@example.com')).toBe(true);
    expect(await svc.apply('r2', 'u2', 'dup@example.com')).toBe(false); // already referred
  });

  it('does nothing without a referrer code', async () => {
    const { svc, grantor } = make();
    expect(await svc.apply('', 'u1', 'x@example.com')).toBe(false);
    expect(grantor.grantReferralMonth).not.toHaveBeenCalled();
  });

  // A garbage/unknown opaque code resolves to no one → credits no one.
  it('rejects an unknown referral code (resolves to no referrer)', async () => {
    const { svc, grantor } = make(async () => null); // nothing resolves
    expect(await svc.apply('deadbeef00', 'u1', 'x@example.com')).toBe(false);
    expect(grantor.grantReferralMonth).not.toHaveBeenCalled();
  });
});
