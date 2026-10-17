import { describe, it, expect } from 'vitest';
import { isValidDateOnly, isValidMeetingDatetime } from './validate-date.js';

describe('[P18-6] isValidDateOnly', () => {
  it('accepts a real calendar date', () => {
    expect(isValidDateOnly('2026-08-01')).toBe(true);
    expect(isValidDateOnly('2026-02-28')).toBe(true);
  });
  it('rejects empty, malformed, and impossible dates', () => {
    expect(isValidDateOnly('')).toBe(false);
    expect(isValidDateOnly('not-a-date')).toBe(false);
    expect(isValidDateOnly('2026-13-40')).toBe(false); // month 13, day 40
    expect(isValidDateOnly('2026-02-30')).toBe(false); // Feb 30 doesn't exist
    expect(isValidDateOnly('2026-8-1')).toBe(false);   // not zero-padded
    expect(isValidDateOnly('2026-08-01T10:00')).toBe(false); // has a time
  });
});

describe('[P18-6] isValidMeetingDatetime', () => {
  const tz = 'Asia/Dubai';
  it('accepts a wall-clock the zone can resolve and an absolute instant', () => {
    expect(isValidMeetingDatetime('2026-07-09T17:00', tz)).toBe(true);
    expect(isValidMeetingDatetime('2026-07-09T13:00:00.000Z', tz)).toBe(true);
  });
  it('rejects empty and garbage', () => {
    expect(isValidMeetingDatetime('', tz)).toBe(false);
    expect(isValidMeetingDatetime('not-a-date', tz)).toBe(false);
  });
});
