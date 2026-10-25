import { describe, it, expect, vi, afterEach } from 'vitest';
import { meetingDay } from './meeting-day.js';

/**
 * [P43-7 · owner] A date-only meeting's day is counted from the MESSAGE that said it, never from today: "Saturday"
 * said on Wed 15 Apr 2026 is Sat 18 Apr 2026, whatever today is.
 */
afterEach(() => { vi.useRealTimers(); });

describe('[P43-7] meetingDay counts from the message date', () => {
  it('"Saturday" said on Wed 15 Apr 2026 → Sat 18 Apr 2026, with today set to 25 Oct 2026', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T09:00:00Z'));
    expect(meetingDay({ datetime: null, datetimeRaw: 'Saturday', sourceMessageAt: '2026-04-15T10:00', captureAt: '2026-10-20' })).toBe('2026-04-18');
  });

  it('with no per-message time, the conversation date is the anchor (never today)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T09:00:00Z'));
    expect(meetingDay({ datetime: null, datetimeRaw: 'Saturday', sourceMessageAt: null, captureAt: '2026-04-15' })).toBe('2026-04-18');
  });

  it('NEGATIVE: no message date and no conversation date → no day (today is never used)', () => {
    expect(meetingDay({ datetime: null, datetimeRaw: 'Saturday', sourceMessageAt: null, captureAt: null })).toBeNull();
  });

  it('NEGATIVE: a meeting that already has a time has no separate day', () => {
    expect(meetingDay({ datetime: '2026-04-18T11:00:00.000Z', datetimeRaw: 'Saturday', sourceMessageAt: '2026-04-15T10:00' })).toBeNull();
  });
});
