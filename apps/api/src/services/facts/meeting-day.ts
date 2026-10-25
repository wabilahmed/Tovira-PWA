import { resolveDueDate } from '../extraction/resolve-date.js';

/**
 * [P43-7 · owner] A meeting said with a day but no time ("Saturday") keeps its day and asks only for the time. The day
 * is the one the shared deterministic resolver reads for a promise's due date, anchored to the meeting's own message
 * (else its conversation date): "Saturday" said on Wed 21 Oct → 2026-10-24. "next Tuesday" and "the 5th" stay null, as
 * the resolver leaves them. Derived on read, never stored; null once the meeting has a time.
 */
export function meetingDay(m: { datetime: string | null; datetimeRaw: string; sourceMessageAt?: string | null; captureAt?: string | null }): string | null {
  if (m.datetime) return null;
  return resolveDueDate(m.datetimeRaw, m.sourceMessageAt ?? m.captureAt ?? null).date;
}
