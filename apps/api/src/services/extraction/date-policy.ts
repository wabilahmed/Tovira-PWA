import type { ExtractedPromise, KeyDate, Meeting } from './types.js';
import { resolveDueDate, extractClockTime } from './resolve-date.js';

/**
 * [P40-1] The one rule for every date Tovira stores from an extraction: it comes from the deterministic resolver
 * (resolve-date.ts), NEVER from the model's own guess. When the resolver has nothing, the date is null, the raw
 * phrase is kept, and the item is marked "date to confirm" — the rep answers it in Needs your answer.
 *
 * The one exception: the model's date stands when the receipt quote itself carries that exact explicit date
 * ("25/04/2026", "2026-04-25") and the resolver reads that text as the same date. A date without a year
 * ("25 April") is not readable without guessing, so it never qualifies.
 *
 * Before P40 the write path used `resolved ?? model` — the P39 "Sunday morning" → 20 Oct bug was that fallback.
 */
export interface TrustedDate { date: string | null; toConfirm: boolean }

const EXPLICIT = /\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g;

/** Every explicit date the resolver can read in a quote (YYYY-MM-DD). */
function explicitDatesIn(quote: string | null | undefined, dayFirst: boolean): string[] {
  if (!quote) return [];
  return [...quote.matchAll(EXPLICIT)].map((m) => resolveDueDate(m[0], null, { dayFirst }).date).filter((d): d is string => d !== null);
}

function trusted(resolved: string | null | undefined, model: string | null, raw: string | null, quote: string | null | undefined, dayFirst: boolean): TrustedDate {
  if (resolved) return { date: resolved, toConfirm: false };
  if (model && explicitDatesIn(quote, dayFirst).includes(model)) return { date: model, toConfirm: false };
  // Something was said (a phrase, or the model thought there was a date): the rep confirms it.
  return { date: null, toConfirm: Boolean((raw && raw.trim()) || model) };
}

export function trustedPromiseDate(p: ExtractedPromise, opts: { dayFirst?: boolean } = {}): TrustedDate {
  return trusted(p.resolved_due_date, p.due_date, p.due_raw, p.source_span, opts.dayFirst === true);
}

export function trustedKeyDate(k: KeyDate, opts: { dayFirst?: boolean } = {}): TrustedDate {
  return trusted(k.resolved_date, k.date, k.date_raw, k.source_span, opts.dayFirst === true);
}

/** A meeting's wall clock ("YYYY-MM-DDTHH:MM"): the resolver's, or the model's only when the quote carries that
 *  exact explicit date AND clock time. Otherwise null — the meeting stays unconfirmed with its phrase. */
export function trustedMeetingDatetime(m: Meeting, opts: { dayFirst?: boolean } = {}): string | null {
  if (m.resolved_datetime) return m.resolved_datetime;
  if (!m.datetime) return null;
  const [day, time] = m.datetime.split('T');
  const quote = m.source_span ?? null;
  if (day && time && explicitDatesIn(quote, opts.dayFirst === true).includes(day) && quote && extractClockTime(quote) === time.slice(0, 5)) return m.datetime;
  return null;
}

/** [P40-1] What the facts spine stores from an extraction: every promise and key date through the rule above.
 *  The single projection the write path (extraction) and the held-note commit ("Add a note") both use. */
export function factsProjection(extraction: { promises: ExtractedPromise[]; key_dates: KeyDate[] }, opts: { dayFirst?: boolean } = {}): {
  promises: Array<ExtractedPromise & { date_status: 'to_confirm' | null }>;
  keyDates: KeyDate[];
} {
  return {
    promises: extraction.promises.map((p) => {
      const t = trustedPromiseDate(p, opts);
      return { ...p, due_date: t.date, date_status: t.toConfirm ? 'to_confirm' : null };
    }),
    keyDates: extraction.key_dates.map((k) => ({ ...k, date: trustedKeyDate(k, opts).date })),
  };
}
