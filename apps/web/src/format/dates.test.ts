import { describe, it, expect } from 'vitest';
import { formatStamp, formatBody, formatRange, daysSince } from './dates.js';

// [TOKENS §10 finish rules] One date format app-wide: `14 MAR 2026` in mono
// stamps, `14 Mar 2026` in body copy. No "3/14/26" anywhere, ever.
describe('date formatter', () => {
  it('renders a stamp as "DD MON YYYY" in caps', () => {
    expect(formatStamp('2026-03-14')).toBe('14 MAR 2026');
  });

  it('renders body copy as "DD Mon YYYY"', () => {
    expect(formatBody('2026-03-14')).toBe('14 Mar 2026');
  });

  it('is timezone-stable for date-only strings (never drifts a day)', () => {
    expect(formatStamp('2026-01-01')).toBe('1 JAN 2026');
    expect(formatBody('2026-12-31')).toBe('31 Dec 2026');
  });

  it('reads the date part of a full ISO timestamp', () => {
    expect(formatStamp('2026-01-16T10:00:00')).toBe('16 JAN 2026');
    expect(formatBody('2026-01-16T23:30:00Z')).toBe('16 Jan 2026');
  });

  it('accepts epoch millis and Date', () => {
    expect(formatBody(Date.parse('2026-08-11T00:00:00'))).toBe('11 Aug 2026');
    expect(formatStamp(new Date(2026, 2, 14))).toBe('14 MAR 2026');
  });

  it('never emits slash-formatted dates', () => {
    for (const s of ['2026-03-14', '2026-01-16T10:00:00']) {
      expect(formatStamp(s)).not.toMatch(/\d\/\d/);
      expect(formatBody(s)).not.toMatch(/\d\/\d/);
    }
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatStamp('not a date')).toBe('');
    expect(formatBody('')).toBe('');
  });

  it('formats a same-year week range with an en-dash and one year', () => {
    expect(formatRange('2026-03-16', '2026-03-22')).toBe('16 Mar – 22 Mar 2026');
  });

  it('spells both years across a year boundary', () => {
    expect(formatRange('2025-12-29', '2026-01-04')).toBe('29 Dec 2025 – 4 Jan 2026');
  });

  it('counts whole elapsed days, floored and never negative', () => {
    const day = 86_400_000;
    expect(daysSince(Date.parse('2026-06-01T00:00:00'), Date.parse('2026-06-01T00:00:00') + 21 * day)).toBe(21);
    expect(daysSince(Date.now() + day, Date.now())).toBe(0);
  });
});
