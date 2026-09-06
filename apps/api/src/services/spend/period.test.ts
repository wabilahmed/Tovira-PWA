import { describe, it, expect } from 'vitest';
import { periodKeyFrom } from './period.js';

const NOW = Date.parse('2026-09-06T00:00:00Z');
const win = (over: Partial<Parameters<typeof periodKeyFrom>[0]> = {}) =>
  ({ status: 'active', trialEndsAt: null, renewsAt: null, periodStart: null, ...over });

describe('[BILLING-PERIOD] periodKeyFrom — anchor on the stored period start, never invent one', () => {
  it('an active sub with a stored start keys off it (authoritative)', () => {
    const r = periodKeyFrom(win({ status: 'active', periodStart: 1_700_000_000_000, renewsAt: 1_702_000_000_000 }), NOW);
    expect(r).toEqual({ key: 'p:1700000000000', fallback: false });
  });

  it('a plan change (new start) rolls to a NEW bucket key; the old spend stays in the old key', () => {
    const before = periodKeyFrom(win({ status: 'active', periodStart: 1_700_000_000_000 }), NOW);
    const after = periodKeyFrom(win({ status: 'active', periodStart: 1_705_000_000_000 }), NOW); // Stripe issued a new period
    expect(after.key).not.toBe(before.key); // new bucket → new period starts clean
    expect(after.fallback).toBe(false);
  });

  it('a trialing account has no paid-period start → an explicit, marked fallback bucket', () => {
    const r = periodKeyFrom(win({ status: 'trialing', trialEndsAt: 1_699_000_000_000, periodStart: null }), NOW);
    expect(r.key).toBe('t:1699000000000');
    expect(r.fallback).toBe(true); // derived from the trial window, not a Stripe period
  });

  it('an active sub created before this field (no start) falls back to the end anchor, marked', () => {
    const r = periodKeyFrom(win({ status: 'active', periodStart: null, renewsAt: 1_702_000_000_000 }), NOW);
    expect(r).toEqual({ key: 'pf:end:1702000000000', fallback: true });
  });

  it('with neither start nor end, the last resort is a marked calendar-month bucket (never invented as authoritative)', () => {
    const r = periodKeyFrom(win({ status: 'past_due', periodStart: null, renewsAt: null }), NOW);
    expect(r.key).toBe('pf:m:2026-09');
    expect(r.fallback).toBe(true);
  });
});
