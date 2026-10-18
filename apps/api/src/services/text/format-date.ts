/**
 * [P21-A5] The server-side twin of the web date formatter (apps/web/src/format/dates.ts, brand §10) for
 * text the API itself hands a rep — Ask answers and receipt quotes. Day-month order, 24-hour, never ISO:
 * `7 May 2026` and `7 May 2026, 13:02`. Values are read POSITIONALLY: chat messages carry the export's
 * wall-clock time with no zone, so converting through a timezone would move it.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// YYYY-MM-DD, optionally followed by THH:MM[:SS[.fff]][Z|±HH:MM].
const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\d-])/g;

function render(y: string, mo: string, d: string, hh?: string, mm?: string): string | null {
  const m = Number(mo);
  const day = Number(d);
  if (m < 1 || m > 12 || day < 1 || day > 31) return null;
  const date = `${day} ${MONTHS[m - 1]} ${y}`;
  return hh !== undefined && mm !== undefined ? `${date}, ${hh}:${mm}` : date;
}

/** `2026-05-07T13:02:00` → `7 May 2026, 13:02`; a date-only value → `7 May 2026`; null/unparseable → ''. */
export function formatMessageStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  ISO.lastIndex = 0;
  const m = ISO.exec(iso.trim());
  ISO.lastIndex = 0;
  return m ? render(m[1]!, m[2]!, m[3]!, m[4], m[5]) ?? '' : '';
}

/** Replace every ISO date / timestamp inside free text with its readable form. Only ISO shapes are
 *  touched — "20/03/2026", amounts and references are left exactly as written. */
export function humanizeIsoDates(text: string): string {
  return text.replace(ISO, (whole, y: string, mo: string, d: string, hh?: string, mm?: string) => render(y, mo, d, hh, mm) ?? whole);
}
