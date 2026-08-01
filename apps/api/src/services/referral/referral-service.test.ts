import { describe, it, expect, vi } from 'vitest';
import { ReferralService } from './referral-service.js';
import { InMemoryReferralRepository } from '../../adapters/referral/in-memory-referral-repository.js';

function make() {
  const repo = new InMemoryReferralRepository();
  const granted: string[] = [];
  const grantor = { grantReferralMonth: vi.fn(async (id: string) => { granted.push(id); return true; }) };
  return { svc: new ReferralService(repo, grantor), granted, grantor };
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
});
