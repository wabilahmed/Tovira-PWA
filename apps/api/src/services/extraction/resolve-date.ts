/**
 * [P14-3] Deterministic post-extraction date resolution.
 *
 * The certified extraction prompt resolves relative dates against a SINGLE "today" injected at call time.
 * For a chat IMPORT that is the import's reference date — but a chat spans many days/years, so a promise
 * said long ago ("by Thursday") resolved against the import date, landing before it and being nulled by
 * the DATE-INVARIANT (observed in prod: `[date-invariant] due_date … < reference … — nulled`). The fix:
 * resolve each phrase deterministically against the DATE OF THE MESSAGE it was said in (source_message_at),
 * AFTER extraction, in code the prompt never touches.
 *
 * It NEVER guesses. It returns null for exactly what the certified prompt leaves null:
 *   - vague timing ("sometime after the holidays"),
 *   - a date with no year ("March 3rd", "the 14th"),
 *   - an AMBIGUOUS numeric date whose day/month order is not forced ("12/04/2026" = 12 Apr OR 4 Dec —
 *     choosing one would be a locale guess; the prompt refuses it, so does this),
 *   - "next <weekday>" (which week it means is ambiguous in English).
 * The original phrase is always preserved by the caller (due_raw / date_raw), so nothing is lost.
 */
import type { ExtractedPromise, KeyDate, Meeting } from './types.js';
import { normalizeName } from '../text/normalize-name.js';

export type DateResolution = 'explicit' | 'relative';
export interface ResolvedDate {
  /** YYYY-MM-DD, or null when the phrase cannot be resolved without guessing. */
  date: string | null;
  /** 'explicit' = a fully-specified date in the phrase; 'relative' = resolved against the message date. */
  resolution: DateResolution | null;
}

const NONE: ResolvedDate = { date: null, resolution: null };
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
// [P18-2] Arabic forms, keyed on normalizeName() output (harakat/tatweel stripped, alef/ya/ta folded):
// weekday → dow index; plus today/tomorrow. "يوم X" (literally "day X") is handled by stripping a leading "يوم".
const ARABIC_WEEKDAYS: Record<string, number> = {
  'الاحد': 0, 'الاثنين': 1, 'الثلاثاء': 2, 'الاربعاء': 3, 'الخميس': 4, 'الجمعه': 5, 'السبت': 6,
};
const ARABIC_TODAY = 'اليوم';
const ARABIC_TOMORROW = 'غدا'; // غداً / غدا both normalise to this

/** The anchor's UTC calendar day as a Date at 00:00:00Z — all arithmetic is in UTC to avoid TZ drift. */
function anchorDay(sourceMessageAt: string | null): Date | null {
  if (!sourceMessageAt) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(sourceMessageAt.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** [P18-2] The next occurrence of a weekday STRICTLY AFTER the anchor — "on Monday" said on a Monday
 *  means NEXT Monday (+7), never the same day. (P14's spec rule; the same-day reading was the bug.) */
function nextWeekdayAfter(anchor: Date, dow: number): string {
  let delta = (dow - anchor.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  return iso(new Date(anchor.getTime() + delta * DAY_MS));
}

/** A real calendar date in UTC (validates ranges, rejects e.g. month 13 or day 32). */
function utcDate(y: number, mo1: number, d: number): Date | null {
  if (mo1 < 1 || mo1 > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo1 - 1, d));
  // Reject rollover (e.g. 31 Feb → 3 Mar): the components must round-trip.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo1 - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** Try to read a FULLY-SPECIFIED absolute date (needs no anchor). Null otherwise. `dayFirst` (true for a
 *  WhatsApp import, whose own timestamps are parsed day-first) lets an otherwise-ambiguous A/B/YYYY resolve
 *  as DD/MM; without it, an ambiguous order stays null (no locale guess — the certified-prompt rule). */
function tryExplicit(phrase: string, dayFirst = false): string | null {
  // ISO YYYY-MM-DD.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(phrase);
  if (m) {
    const d = utcDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return d ? iso(d) : null;
  }
  // Numeric A/B/YYYY (slash, dot or dash).
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(phrase);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    const aIsDay = a > 12;  // a can only be a day
    const bIsDay = b > 12;  // b can only be a day
    let day: number, month: number;
    if (aIsDay !== bIsDay) { [day, month] = aIsDay ? [a, b] : [b, a]; } // order forced by a >12 component
    else if (!aIsDay && !bIsDay && dayFirst) { [day, month] = [a, b]; } // ambiguous, but the chat is day-first
    else return null; // both >12 (impossible), or ambiguous with no day-order proof → refuse
    const d = utcDate(y, month, day);
    return d ? iso(d) : null;
  }
  return null;
}

/** [P16-1/P18-3] Extract an EXPLICIT clock time ("3pm", "3:30pm", "15:00", "9 am") as "HH:MM". Null for
 *  anything ambiguous ("around four", "afternoon") — resolving those would guess, and a wrong time is
 *  worse than letting the rep pick it. Deterministic, no model. */
export function extractClockTime(text: string): string | null {
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (ampm) {
    let h = Number(ampm[1]);
    const mi = ampm[2] ? Number(ampm[2]) : 0;
    const pm = ampm[3]!.toLowerCase() === 'pm';
    if (h < 1 || h > 12 || mi > 59) return null;
    if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12;
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (h24) return `${h24[1]!.padStart(2, '0')}:${h24[2]}`;
  return null;
}

/** [P16-1/P18-3] Pull the date phrase out of free text (a meeting raw is often a whole sentence, not a
 *  clean token) so the resolver — which expects a date phrase — can resolve it. Recognises
 *  today/tomorrow/weekday (optionally this/next), "in N days|weeks", "end of month", and numeric/ISO
 *  dates. Null when none is present; the resolver still decides what is actually resolvable. */
export function extractDatePhrase(text: string): string | null {
  // [P23] An explicit (numeric / ISO) date in the phrase WINS over a weekday or relative word next to it:
  // "Sunday 17/05/2026 at 4pm" is 17 May, never "the Sunday after the message". (An ambiguous numeric date
  // is then left to the resolver, which returns null without a day-order proof — never a weekday guess.)
  const explicit = /\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/.exec(text);
  if (explicit) return explicit[0];
  const re = /\b((?:this|next)\s+)?(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bin\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:days?|weeks?)\b|\bend\s+of\s+(?:the\s+)?month\b/i;
  const m = re.exec(text);
  return m ? m[0] : null;
}

/** [P18-3] Resolve a MEETING phrase to a wall-clock "YYYY-MM-DDTHH:MM" (date phrase anchored to the
 *  message + an explicit clock time), or null when either part can't be resolved without guessing. The
 *  caller turns the wall clock into a UTC instant in the rep's timezone (zonedWallClockToInstant). */
export function resolveDateTime(raw: string | null, sourceMessageAt: string | null, opts: { dayFirst?: boolean } = {}): { datetime: string | null; resolution: DateResolution | null } {
  if (!raw || !raw.trim()) return { datetime: null, resolution: null };
  const phrase = extractDatePhrase(raw);
  const d = phrase ? resolveDueDate(phrase, sourceMessageAt, opts) : NONE;
  const t = extractClockTime(raw);
  if (d.date && t) return { datetime: `${d.date}T${t}`, resolution: d.resolution };
  return { datetime: null, resolution: null };
}

/** Try to resolve a RELATIVE phrase against the anchor (the message day). Null when not a supported
 *  deterministic relative form, or when there is no anchor to resolve against. */
function tryRelative(phrase: string, anchor: Date | null): string | null {
  if (!anchor) return null;

  // [P18-2] Arabic today/tomorrow/weekday (with or without a leading "يوم"). Normalised match.
  const ar = normalizeName(phrase).replace(/^يوم\s+/, '');
  if (ar === ARABIC_TODAY) return iso(anchor);
  if (ar === ARABIC_TOMORROW) return iso(new Date(anchor.getTime() + DAY_MS));
  if (ar in ARABIC_WEEKDAYS) return nextWeekdayAfter(anchor, ARABIC_WEEKDAYS[ar]!);

  // "next <weekday>" is deliberately NOT resolved — which week it refers to is ambiguous in English.
  if (/^next\s+/.test(phrase)) return null;

  if (phrase === 'today') return iso(anchor);
  if (phrase === 'tomorrow') return iso(new Date(anchor.getTime() + DAY_MS));

  // "in N days" / "in N weeks" (N as a digit or a number word up to twelve).
  let m = /^in\s+(\d+|[a-z]+)\s+(day|days|week|weeks)$/.exec(phrase);
  if (m) {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : NUMBER_WORDS[m[1]!];
    if (n === undefined || n <= 0) return null;
    const days = /week/.test(m[2]!) ? n * 7 : n;
    return iso(new Date(anchor.getTime() + days * DAY_MS));
  }

  // "end of month" / "end of the month" → the last day of the anchor's month.
  if (/^end of (the )?month$/.test(phrase)) {
    const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    return iso(last);
  }

  // A bare weekday, optionally "this <weekday>" → the next occurrence STRICTLY AFTER the anchor.
  m = /^(this\s+)?([a-z]+)$/.exec(phrase);
  if (m) {
    const dow = WEEKDAYS.indexOf(m[2]!);
    if (dow === -1) return null;
    return nextWeekdayAfter(anchor, dow);
  }
  return null;
}

/**
 * Resolve a promise/key-date phrase to a YYYY-MM-DD, anchored to the message it was said in. Explicit
 * absolute dates resolve regardless of the anchor; relative phrases need the anchor. Returns
 * {date:null, resolution:null} whenever resolving would require a guess.
 */
export function resolveDueDate(raw: string | null, sourceMessageAt: string | null, opts: { dayFirst?: boolean } = {}): ResolvedDate {
  if (!raw || !raw.trim()) return NONE;
  // Normalise: lowercase, drop a leading "by"/"on"/"due", a trailing time ("at 3pm", "3pm"), and
  // surrounding punctuation/whitespace. Ordinals ("3rd") are left intact so "March 3rd" still fails the
  // no-year rule (it never matches an explicit or relative form → null).
  let phrase = raw.toLowerCase().trim();
  phrase = phrase.replace(/\s+at\s+\d{1,2}(:\d{2})?\s*(am|pm)?$/i, ''); // strip a trailing "at 3pm" / "at 15:30"
  phrase = phrase.replace(/\s+\d{1,2}(:\d{2})?\s*(am|pm)$/i, '');       // strip a trailing bare "3pm"
  phrase = phrase.replace(/^(by|on|due(\s+on)?)\s+/i, '').replace(/[.,;!?]+$/g, '').trim();

  const explicit = tryExplicit(phrase, opts.dayFirst === true);
  if (explicit) return { date: explicit, resolution: 'explicit' };

  const relative = tryRelative(phrase, anchorDay(sourceMessageAt));
  if (relative) return { date: relative, resolution: 'relative' };

  return NONE;
}

/** The YYYY-MM-DD calendar day of a message timestamp (null when absent/unparseable). */
export function messageDay(sourceMessageAt: string | null): string | null {
  const d = anchorDay(sourceMessageAt);
  return d ? iso(d) : null;
}

/**
 * [P14-3] Resolve every promise + key-date in an extraction against its OWN message date
 * (source_message_at), and enforce the DATE-INVARIANT per promise: a commitment can never be due BEFORE
 * the message that made it. `fallbackAnchor` (the note's single reference date) is used only when a
 * promise has no per-message timestamp — a voice/paste note, where the whole note shares one date.
 *
 * Mutates in place: fills resolved_due_date/resolved_date + resolution, and — only for a promise due
 * before its own message (impossible) — nulls the date everywhere and drops confidence to low. Key dates
 * can legitimately be in the past (anniversaries, historical milestones), so no invariant is applied to
 * them. The model's due_date is otherwise left untouched; surfacing prefers resolved_due_date.
 */
export function resolveExtractionDates(
  extraction: { promises: ExtractedPromise[]; key_dates: KeyDate[]; meeting?: Meeting | null },
  fallbackAnchor: string,
  noteId: string,
  opts: { dayFirst?: boolean; log?: (msg: string) => void } = {},
): void {
  const dayFirst = opts.dayFirst === true;
  const log = opts.log ?? ((m: string) => console.warn(m));
  for (const p of extraction.promises) {
    const r = resolveDueDate(p.due_raw ?? null, p.source_message_at ?? null, { dayFirst });
    p.resolved_due_date = r.date;
    p.resolution = r.resolution;
    const anchor = messageDay(p.source_message_at ?? null) ?? fallbackAnchor;
    const effective = p.resolved_due_date ?? p.due_date;
    if (effective !== null && effective < anchor) {
      log(`[date-invariant] note ${noteId}: due ${effective} < message/reference ${anchor} — nulled, low, queued`);
      p.due_date = null;
      p.resolved_due_date = null;
      p.confidence = 'low';
    }
  }
  for (const k of extraction.key_dates) {
    const r = resolveDueDate(k.date_raw ?? null, k.source_message_at ?? null, { dayFirst });
    k.resolved_date = r.date;
    k.resolution = r.resolution;
  }
  // [P18-3] The meeting gets the SAME deterministic resolver (date anchored to its message + a clock
  // time), stored separately in resolved_datetime; the model's datetime/datetime_raw are left untouched.
  const mtg = extraction.meeting;
  if (mtg) {
    const r = resolveDateTime(mtg.datetime_raw ?? null, mtg.source_message_at ?? null, { dayFirst });
    mtg.resolved_datetime = r.datetime;
    mtg.resolution = r.resolution;
  }
}

/** [P14-3] The date surfacing should use for a promise — the deterministic resolution when present, else
 *  the model's own due_date. The single place that expresses "resolved wins, model fills the rest". */
export function effectiveDueDate(p: ExtractedPromise): string | null {
  return p.resolved_due_date ?? p.due_date;
}
