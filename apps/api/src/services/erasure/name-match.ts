/**
 * [ERASURE / TASK 2] The one place name-matching for counterparty scope lives, shared by erasure
 * (what to DELETE) and the processing restriction (what to WITHHOLD during the review window). Keeping
 * a single matcher means the restriction covers exactly the family of facts the erasure itself reaches.
 *
 * Attribution is name-based (there is no third-party entity). A who-field is:
 *   - EXACT   — its normalised value equals a requester name/alias.
 *   - FUZZY   — it shares a whole word with a requester name (e.g. a shared first name), not exact.
 *   - NONE    — neither.
 * A free-text field MENTIONS a requester if it contains a requester name token as a whole word.
 */

export type MatchKind = 'exact' | 'fuzzy' | 'none';

export const normName = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const wordsOf = (s: string): string[] => normName(s).split(' ').filter((w) => w.length > 1);

export function matchName(who: string | null | undefined, requesterNorm: string[]): MatchKind {
  const w = normName(who);
  if (!w) return 'none';
  if (requesterNorm.includes(w)) return 'exact';
  const whoWords = new Set(wordsOf(w));
  for (const rn of requesterNorm) for (const rw of rn.split(' ')) if (rw.length > 1 && whoWords.has(rw)) return 'fuzzy';
  return 'none';
}

/** A free-text field MENTIONS the requester if it contains a requester name token as a whole word.
 *  Punctuation is a boundary so "(Khalid" / "Khalid," / "Khalid's" all count. */
export function mentionsName(text: string | null | undefined, requesterNorm: string[]): boolean {
  const t = ` ${(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return requesterNorm.some((rn) => rn.split(' ').some((w) => w.length > 1 && t.includes(` ${w} `)));
}
