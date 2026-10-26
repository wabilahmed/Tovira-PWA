import { describe, it, expect } from 'vitest';
import { diffPeriods, formatDiff, SUBSCRIPTIONS_SQL } from './audit-subscription-periods.js';

/** [P44-3] READ-ONLY: list each subscription whose stored period differs from Stripe's (the subscription item). */
const OCT = Date.UTC(2026, 9, 26, 12), NOV = Date.UTC(2026, 10, 26, 12), DEC = Date.UTC(2026, 11, 26, 12);

describe('[P44-3] subscription-periods audit', () => {
  it('lists a subscription one period behind, and not one that matches', () => {
    const d = diffPeriods(
      [{ userId: 'u1', subscriptionId: 'sub_behind', status: 'active', start: OCT, end: NOV }, { userId: 'u2', subscriptionId: 'sub_ok', status: 'active', start: NOV, end: DEC }],
      new Map([['sub_behind', { start: NOV, end: DEC }], ['sub_ok', { start: NOV, end: DEC }]]),
    );
    expect(d.map((x) => x.subscriptionId)).toEqual(['sub_behind']);
    expect(formatDiff(d[0]!)).toBe('≠ u1  sub_behind  (active)  stored 2026-10-26T12:00 → 2026-11-26T12:00  Stripe 2026-11-26T12:00 → 2026-12-26T12:00');
  });

  it('a subscription Stripe can\'t read (wrong mode, deleted) is listed as such, never guessed', () => {
    const d = diffPeriods([{ userId: 'u3', subscriptionId: 'sub_test_in_live', status: 'active', start: OCT, end: NOV }], new Map([['sub_test_in_live', null]]));
    expect(d[0]!.why).toBe('stripe_unreadable');
  });

  it('NEGATIVE: read-only: the script reads, it never writes', () => {
    expect(SUBSCRIPTIONS_SQL).toMatch(/^SELECT/);
    expect(SUBSCRIPTIONS_SQL).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
  });
});
