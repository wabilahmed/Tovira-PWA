import { describe, it, expect } from 'vitest';
import { allowanceWindow } from './ai-period.js';

const ms = (iso: string) => Date.parse(iso);

// [USAGE-ALLOWANCE · D1/D11] The monthly allowance window: monthly for everyone, anchored on the billing
// day; annual subscribers reset monthly on that day, not once a year.
describe('[USAGE-ALLOWANCE] allowanceWindow', () => {
  it('a monthly subscriber: the window containing now, anchored on the period-start day', () => {
    const w = allowanceWindow(
      { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: ms('2026-10-09T00:00:00Z') },
      ms('2026-10-20T12:00:00Z'),
    );
    expect(w.anchorDay).toBe(9);
    expect(w.startMs).toBe(ms('2026-10-09T00:00:00Z'));
    expect(w.endMs).toBe(ms('2026-11-09T00:00:00Z'));
    expect(w.key).toBe('m:2026-10');
  });

  it('an ANNUAL subscriber resets MONTHLY on the anchor day (not once a year)', () => {
    // Annual period started 2026-03-15; now is August — the window is Aug 15 .. Sep 15.
    const w = allowanceWindow(
      { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: ms('2026-03-15T00:00:00Z') },
      ms('2026-08-20T09:00:00Z'),
    );
    expect(w.anchorDay).toBe(15);
    expect(w.startMs).toBe(ms('2026-08-15T00:00:00Z'));
    expect(w.endMs).toBe(ms('2026-09-15T00:00:00Z'));
    expect(w.key).toBe('m:2026-08');
  });

  it('before the anchor day, the window is the one that started last month', () => {
    const w = allowanceWindow(
      { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: ms('2026-01-20T00:00:00Z') },
      ms('2026-03-05T00:00:00Z'), // before the 20th
    );
    expect(w.startMs).toBe(ms('2026-02-20T00:00:00Z'));
    expect(w.endMs).toBe(ms('2026-03-20T00:00:00Z'));
    expect(w.key).toBe('m:2026-02');
  });

  it('a day-31 anchor clamps to the last day of a short month', () => {
    const w = allowanceWindow(
      { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: ms('2026-01-31T00:00:00Z') },
      ms('2026-03-10T00:00:00Z'), // in the window that starts on Feb's clamped anchor
    );
    // February's anchor clamps to the 28th; the window runs Feb 28 .. Mar 31.
    expect(w.startMs).toBe(ms('2026-02-28T00:00:00Z'));
    expect(w.endMs).toBe(ms('2026-03-31T00:00:00Z'));
  });

  it('a trial is ONE window keyed to its end', () => {
    const w = allowanceWindow(
      { status: 'trialing', trialEndsAt: ms('2026-10-14T00:00:00Z'), renewsAt: null, periodStart: null },
      ms('2026-10-05T00:00:00Z'),
    );
    expect(w.key).toBe(`trial:${ms('2026-10-14T00:00:00Z')}`);
    expect(w.endMs).toBe(ms('2026-10-14T00:00:00Z'));
    expect(w.anchorDay).toBeNull();
  });

  it('no billing info falls back to a calendar month (anchor day 1)', () => {
    const w = allowanceWindow(
      { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: null },
      ms('2026-10-20T00:00:00Z'),
    );
    expect(w.anchorDay).toBe(1);
    expect(w.key).toBe('cal:2026-10');
    expect(w.startMs).toBe(ms('2026-10-01T00:00:00Z'));
    expect(w.endMs).toBe(ms('2026-11-01T00:00:00Z'));
  });

  it('keys for consecutive windows sort in chronological order', () => {
    const base = { status: 'active' as const, trialEndsAt: null, renewsAt: null, periodStart: ms('2026-01-10T00:00:00Z') };
    const jan = allowanceWindow(base, ms('2026-01-15T00:00:00Z')).key;
    const feb = allowanceWindow(base, ms('2026-02-15T00:00:00Z')).key;
    expect(jan < feb).toBe(true);
  });
});
