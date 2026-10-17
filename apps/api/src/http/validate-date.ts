import { zonedWallClockToInstant } from '../services/time/zone.js';

/**
 * [P18-6] Date validation for in-place edits. A wrong or empty date silently wiping a real stored value
 * is data loss, and an unparseable value reaching the DB is a 500 — so an edit route validates BEFORE it
 * writes, rejects an invalid value with 400, and leaves the stored value untouched.
 */

/** A strict calendar date "YYYY-MM-DD" that actually exists (round-trips — rejects 2026-13-40, '', etc.). */
export function isValidDateOnly(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** A meeting time the resolver can turn into a real instant: an absolute ISO instant (with Z/offset), or
 *  a wall-clock "YYYY-MM-DDTHH:MM[:SS]" the rep's zone accepts. Rejects empty/garbage. */
export function isValidMeetingDatetime(s: string, tz: string): boolean {
  if (!s.trim()) return false;
  const t = Date.parse(s);
  if (!Number.isNaN(t) && /([zZ])|([+-]\d{2}:?\d{2})$/.test(s)) return true; // absolute instant
  try { zonedWallClockToInstant(s, tz); return true; } catch { return false; } // wall-clock in the rep's zone
}
