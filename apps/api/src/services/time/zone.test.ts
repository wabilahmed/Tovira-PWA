import { describe, it, expect } from 'vitest';
import { DEFAULT_TIME_ZONE, isValidTimeZone, normalizeTimeZone, zonedTodayIso, zonedWallClockToInstant } from './zone.js';

describe('[NUDGE-TZ] IANA timezone helpers', () => {
  it('the default is Asia/Dubai (launch ICP)', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Asia/Dubai');
  });

  it('validates real IANA names and rejects offsets / garbage', () => {
    expect(isValidTimeZone('Asia/Dubai')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Europe/London')).toBe(true);
    // A fixed offset is NOT an IANA zone — DST needs a named zone.
    expect(isValidTimeZone('+04:00')).toBe(false);
    expect(isValidTimeZone('UTC+4')).toBe(false);
    expect(isValidTimeZone('Mars/Phobos')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('normalizes an invalid or missing zone to the default, keeps a valid one', () => {
    expect(normalizeTimeZone('America/New_York')).toBe('America/New_York');
    expect(normalizeTimeZone('+04:00')).toBe(DEFAULT_TIME_ZONE);
    expect(normalizeTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(normalizeTimeZone('')).toBe(DEFAULT_TIME_ZONE);
  });

  it('resolves a wall-clock in Asia/Dubai (UTC+4, no DST) to the right absolute instant', () => {
    // 15:00 in Dubai is 11:00 UTC — regardless of the server clock.
    expect(zonedWallClockToInstant('2026-07-09T15:00', 'Asia/Dubai').toISOString()).toBe('2026-07-09T11:00:00.000Z');
  });

  it('resolves a wall-clock across DST correctly for a DST zone', () => {
    // America/New_York: July is EDT (UTC-4) → 15:00 local = 19:00 UTC.
    expect(zonedWallClockToInstant('2026-07-09T15:00', 'America/New_York').toISOString()).toBe('2026-07-09T19:00:00.000Z');
    // January is EST (UTC-5) → 15:00 local = 20:00 UTC. Proves it is IANA (DST-aware), not a fixed offset.
    expect(zonedWallClockToInstant('2026-01-09T15:00', 'America/New_York').toISOString()).toBe('2026-01-09T20:00:00.000Z');
  });

  it('gives the rep-local date, which can differ from the server/UTC date near midnight', () => {
    // 23:30 UTC is already the next day in Dubai (UTC+4 → 03:30).
    const lateUtc = new Date('2026-07-09T23:30:00.000Z');
    expect(zonedTodayIso('Asia/Dubai', lateUtc)).toBe('2026-07-10');
    expect(zonedTodayIso('Etc/UTC', lateUtc)).toBe('2026-07-09');
  });

  it('accepts an already-absolute ISO instant (with Z / offset) unchanged', () => {
    // If the caller already resolved the zone (offset present), respect it.
    expect(zonedWallClockToInstant('2026-07-09T11:00:00.000Z', 'Asia/Dubai').toISOString()).toBe('2026-07-09T11:00:00.000Z');
    expect(zonedWallClockToInstant('2026-07-09T15:00:00+04:00', 'Asia/Dubai').toISOString()).toBe('2026-07-09T11:00:00.000Z');
  });
});
