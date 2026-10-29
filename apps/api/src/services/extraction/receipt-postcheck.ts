import type { Extraction } from './types.js';
import { screenPrecise } from '../screening/precise-screen.js';

/**
 * [P18-8] Write-time backstop: a receipt (`source_span`) must be a VERBATIM excerpt of the note text the
 * model saw. Rule 9 instructs the model to quote verbatim, but a model rule can slip — a paraphrased span
 * (e.g. the model writes "chase" where the message said "I'll chase them tomorrow") is a FABRICATED
 * receipt, and the trust rules forbid that as strongly as a fabricated fact. So, deterministically, drop
 * (null) any `source_span` that is not a substring of the input; the FACT is kept, only its unverifiable
 * receipt is removed. Same doctrine as the DATE-INVARIANT and health-exclusion backstops: a model rule
 * can slip, a write-time check cannot.
 *
 * Whitespace-tolerant (a verbatim quote that differs only in run-of-whitespace — a newline the model
 * rendered as a space — is still the real excerpt), but otherwise an exact substring match.
 */
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

function isVerbatim(span: string, text: string, collapsedText: string): boolean {
  if (text.includes(span)) return true;
  const c = collapse(span);
  return c.length > 0 && collapsedText.includes(c);
}

export function dropNonVerbatimSpans(extraction: Extraction, inputText: string): number {
  const collapsed = collapse(inputText);
  let dropped = 0;
  const check = (holder: { source_span?: string | null }): void => {
    const span = holder.source_span;
    if (typeof span === 'string' && span.trim().length > 0 && !isVerbatim(span, inputText, collapsed)) {
      holder.source_span = null;
      dropped += 1;
    }
  };
  for (const p of extraction.promises) check(p);
  for (const k of extraction.key_dates) check(k);
  for (const pf of extraction.personal_facts) check(pf);
  for (const person of extraction.people) check(person);
  if (extraction.meeting) check(extraction.meeting);
  return dropped;
}

/**
 * [P55-3 · owner] Option C: a receipt never quotes special-category content. A `source_span` the precise sensitive list
 * flags (a diagnosis, a conviction, a personal statement of faith, a vote or party, caste, orientation) is dropped; the
 * fact is kept without its quote, the same way an unverifiable quote is. Applied in production and in the gate.
 */
export function dropSensitiveSpans(extraction: Extraction): number {
  let dropped = 0;
  const check = (holder: { source_span?: string | null }): void => {
    const span = holder.source_span;
    if (typeof span === 'string' && span.trim().length > 0 && screenPrecise(span).length > 0) {
      holder.source_span = null;
      dropped += 1;
    }
  };
  for (const p of extraction.promises) check(p);
  for (const k of extraction.key_dates) check(k);
  for (const pf of extraction.personal_facts) check(pf);
  for (const person of extraction.people) check(person);
  if (extraction.meeting) check(extraction.meeting);
  return dropped;
}
