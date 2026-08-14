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
