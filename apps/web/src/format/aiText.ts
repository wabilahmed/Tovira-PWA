import { humanizeIsoDates } from './dates.js';

/** A full clause after the dash (this many words or more) starts a new sentence; a shorter tail takes a comma. */
const CLAUSE_WORDS = 4;
/** The em-dash, written as an escape so the copy guard never mistakes this code for copy. */
const EM_DASH = '\u2014';

/**
 * [P46-4] The one display transform for model-written text (pointers, brief fields, summaries, promise wording): ISO
 * dates read as dates ([P21-D]) and no em-dash reaches the rep ([P40-4] copy rule). Applied at DISPLAY time only:
 * stored text is never rewritten, and receipts (the client's own words) never pass through here.
 *   "July — anchor the next meeting on the plan" → "July. Anchor the next meeting on the plan"
 *   "Wants a villa — ideally Mirdif"              → "Wants a villa, ideally Mirdif"
 *   "Her husband — the decision maker — prefers"  → "Her husband, the decision maker, prefers"
 */
export function aiText(text: string): string {
  let s = humanizeIsoDates(text);
  if (!s.includes(EM_DASH)) return s;
  s = s.replace(/^\s*\u2014\s*/, '').replace(/\s*\u2014\s*$/, (m) => (m.trim() ? '.' : ''));
  // Paired asides inside one sentence: "A (dash) B (dash) C" → "A, B, C".
  s = s.replace(/\s*\u2014\s*([^\u2014.!?]+?)\s*\u2014\s*/g, ', $1, ');
  // A single dash: a full clause after it starts a sentence, a short tail takes a comma.
  s = s.replace(/\s*\u2014\s*([^.!?]*)/g, (_m, rest: string) => {
    const words = rest.trim().split(/\s+/).filter(Boolean).length;
    if (words >= CLAUSE_WORDS) return `. ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
    return `, ${rest}`;
  });
  return s.replace(/\s+,/g, ',').replace(/,\s*\./g, '.').replace(/\.\./g, '.');
}
