/**
 * [P16] Shared name normalisation for matching a person/client name across surfaces — the meeting-parse
 * client match (P16-1) and the import counterpart↔client comparison (P16-2). Folds the differences that
 * are never meaningful for a name match: letter case, Unicode diacritics (Latin accents + Arabic
 * harakat), Arabic letter-form variants (alef/ya/ta-marbuta/hamza seats, tatweel), and runs of
 * whitespace/punctuation. It is deterministic and locale-free — it never translates or transliterates.
 */

// Arabic combining marks (harakat, tanwin, shadda, sukun, superscript alef) — stripped.
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g; // kashida — a pure stretch glyph, never meaningful

function foldArabicLetters(s: string): string {
  return s
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ → ا (alef forms)
    .replace(/ى/g, 'ي')                       // ى → ي (alef maqsura → ya)
    .replace(/ة/g, 'ه')                       // ة → ه (ta marbuta → ha)
    .replace(/ؤ/g, 'و')                       // ؤ → و (hamza on waw)
    .replace(/ئ/g, 'ي');                      // ئ → ي (hamza on ya)
}

/** Normalise a name to a comparison key. Empty-string in → empty-string out. */
export function normalizeName(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFKD');
  // Strip Latin combining diacritics left by NFKD (é → e).
  s = s.replace(/[̀-ͯ]/g, '');
  s = s.toLowerCase();
  s = s.replace(ARABIC_DIACRITICS, '').replace(TATWEEL, '');
  s = foldArabicLetters(s);
  // Collapse any run of non-alphanumeric (spaces, punctuation, separators) to a single space.
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return s;
}

/** True when two names are the same after normalisation (whole-string equality on the folded key).
 *  Used for the import counterpart↔client comparison (P16-2), where a WRONG match is worse than none. */
export function namesEqual(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na.length > 0 && na === nb;
}

/** True when any token (≥2 chars) of `name` appears as a whole token in `text` — a best-effort "which
 *  client does this free-text request mention?" (P16-1). Deliberately loose: a false match here only
 *  routes the rep to a client picker (ambiguous), never a silent wrong assignment, so over-matching is
 *  safe and under-matching just means the rep names the client — unlike namesEqual, which must be exact. */
export function nameMentionedIn(name: string, text: string): boolean {
  const textTokens = new Set(normalizeName(text).split(' ').filter((t) => t.length >= 2));
  const nameTokens = normalizeName(name).split(' ').filter((t) => t.length >= 2);
  return nameTokens.length > 0 && nameTokens.some((t) => textTokens.has(t));
}
