/**
 * [NUDGE-TZ] IANA timezone helpers. "2 hours before" is meaningless without a clock:
 * a meeting's wall-clock time ("3pm") must be resolved to an absolute instant IN THE
 * REP'S ZONE, or a Dubai rep on a UTC server is nudged four hours off. We store an IANA
 * name (not a fixed offset) so DST in the markets we expand to is handled correctly.
 */

export const DEFAULT_TIME_ZONE = 'Asia/Dubai'; // launch ICP — a default, never an assumption

/** True only for a real IANA zone name (a fixed offset like "+04:00" is rejected). */
export function isValidTimeZone(tz: string | undefined | null): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    // Intl throws RangeError on an unknown/invalid timeZone; offsets are not accepted here.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A valid IANA zone as given, otherwise the default. */
export function normalizeTimeZone(tz: string | undefined | null): string {
  return isValidTimeZone(tz) ? (tz as string) : DEFAULT_TIME_ZONE;
}

const ABSOLUTE_RE = /[zZ]$|[+-]\d{2}:?\d{2}$/; // trailing Z or ±HH:MM → already absolute
const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/** The calendar date (YYYY-MM-DD) it is *right now* in `tz` — the rep's "today",
 *  so a relative parse ("tomorrow 3pm") and day boundaries use their clock, not the server's. */
export function zonedTodayIso(tz: string, now: Date = new Date()): string {
  // en-CA renders as YYYY-MM-DD; timeZone shifts it to the zone's local date.
  return new Intl.DateTimeFormat('en-CA', { timeZone: normalizeTimeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The UTC offset (ms) that `tz` had at a given absolute instant. */
function zoneOffsetMsAt(tz: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  let hour = get('hour');
  if (hour === 24) hour = 0; // some engines render midnight as 24
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asIfUtc - instant.getTime();
}

/**
 * Resolve a wall-clock time (`YYYY-MM-DDTHH:MM[:SS]`, no zone) in `tz` to the absolute instant.
 * If the input already carries a zone (trailing Z or ±HH:MM), it is absolute and returned as-is.
 * DST-safe via a two-pass offset resolution (the offset can differ side-of-transition).
 */
export function zonedWallClockToInstant(wall: string, tz: string): Date {
  if (ABSOLUTE_RE.test(wall.trim())) return new Date(wall);
  const m = WALL_RE.exec(wall.trim());
  if (!m) throw new Error(`not a wall-clock time: ${wall}`);
  const [, Y, Mo, D, H, Mi, S] = m;
  const naiveAsUtc = Date.UTC(Number(Y), Number(Mo) - 1, Number(D), Number(H), Number(Mi), Number(S ?? 0));
  // First guess using the offset at the naive instant, then refine once for DST edges.
  let offset = zoneOffsetMsAt(tz, new Date(naiveAsUtc));
  offset = zoneOffsetMsAt(tz, new Date(naiveAsUtc - offset));
  return new Date(naiveAsUtc - offset);
}
