/**
 * The one date formatter (docs/tovira-brand.md §10 finish rules). Every date in
 * the UI goes through here: `14 MAR 2026` (caps) for mono stamps, `14 Mar 2026`
 * for body copy. Never "3/14/26". Date-only strings are read positionally so a
 * timezone can never drift the day.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type DateInput = Date | string | number;

function parts(input: DateInput): { d: number; m: number; y: number } | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return { d: input.getDate(), m: input.getMonth(), y: input.getFullYear() };
  }
  if (typeof input === 'number') {
    const dt = new Date(input);
    if (Number.isNaN(dt.getTime())) return null;
    return { d: dt.getDate(), m: dt.getMonth(), y: dt.getFullYear() };
  }
  const s = input.trim();
  if (!s) return null;
  // A leading YYYY-MM-DD is read positionally (stable across timezones), whether
  // it stands alone or begins a full ISO timestamp.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(s);
  if (iso) return { d: Number(iso[3]), m: Number(iso[2]) - 1, y: Number(iso[1]) };
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return { d: dt.getDate(), m: dt.getMonth(), y: dt.getFullYear() };
}

/** Mono stamp form, caps: `14 MAR 2026`. Empty string if unparseable. */
export function formatStamp(input: DateInput): string {
  const p = parts(input);
  return p ? `${p.d} ${MONTHS[p.m]!.toUpperCase()} ${p.y}` : '';
}

/** Body form, title case: `14 Mar 2026`. Empty string if unparseable. */
export function formatBody(input: DateInput): string {
  const p = parts(input);
  return p ? `${p.d} ${MONTHS[p.m]} ${p.y}` : '';
}

/** [Item 12] Date + time in DAY-month order, 24-hour, in the rep's IANA timezone: `14 Oct 2026, 18:23`.
 *  Never US month-day order. Empty string if unparseable; an unknown timezone falls back to local. */
export function formatDateTime(input: DateInput, timeZone?: string): string {
  const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input);
  if (Number.isNaN(ms)) return '';
  const base: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...base, ...(timeZone ? { timeZone } : {}) }).format(ms);
  } catch {
    return new Intl.DateTimeFormat('en-GB', base).format(ms); // unknown tz → local
  }
}

/** A date range in body form with a real en-dash: `16 Mar – 22 Mar 2026`. */
export function formatRange(start: DateInput, end: DateInput): string {
  const a = parts(start);
  const b = parts(end);
  if (!a || !b) return '';
  const left = a.y === b.y ? `${a.d} ${MONTHS[a.m]}` : `${a.d} ${MONTHS[a.m]} ${a.y}`;
  return `${left} – ${b.d} ${MONTHS[b.m]} ${b.y}`;
}

/** Whole days elapsed between two epoch-ms instants, floored, never negative. */
export function daysSince(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - fromMs) / 86_400_000));
}

/** Just the month + year, for possession lines: `MAR 2026`. */
export function formatMonthYear(input: DateInput): string {
  const p = parts(input);
  return p ? `${MONTHS[p.m]!.toUpperCase()} ${p.y}` : '';
}

// YYYY-MM-DD, optionally followed by THH:MM[:SS[.fff]][Z|±HH:MM] — the only shape humanizeIsoDates touches.
const ISO_IN_TEXT = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\d-])/g;

/** [P21-D] Replace every ISO date / timestamp inside free text (a pointer, a model-written line) with the
 *  body form — `6 Apr 2026`, or `2 Apr 2026, 13:02` with a time — read positionally (wall-clock, no
 *  timezone shift). Only ISO shapes are touched: "20/03/2026", amounts and references stay as written. */
export function humanizeIsoDates(text: string): string {
  return text.replace(ISO_IN_TEXT, (whole, y: string, mo: string, d: string, hh?: string, mm?: string) => {
    const m = Number(mo);
    const day = Number(d);
    if (m < 1 || m > 12 || day < 1 || day > 31) return whole;
    const date = `${day} ${MONTHS[m - 1]} ${y}`;
    return hh !== undefined && mm !== undefined ? `${date}, ${hh}:${mm}` : date;
  });
}
