import { displayPhone } from '../format/phone.js';
/**
 * [CLIENT-SEARCH · P12 Feature 2] Find clients by name, phone OR email — all at once. [P36-6] Also by alias.
 *
 * This runs ENTIRELY in the browser over the already-loaded client list. That is a deliberate privacy
 * choice: the search text never leaves the device, so it can never land in a CloudFront / ALB access
 * log (a client name or phone number is personal data). It is also instant at the beta's scale (a few
 * hundred clients) with no network round-trip per keystroke.
 *
 * Matching rules:
 *  - Case-insensitive, substring-anywhere, partial (`ahm` → "Ahmed", `@emaar` → "x@emaar.ae").
 *  - Arabic is normalised on BOTH sides: أ/إ/آ→ا, ة→ه, ى→ي, and diacritics + tatweel are stripped,
 *    so `احمد` finds `أحمد`.
 *  - Phones compare digits-only; a leading `0` (trunk) and a leading `971` (country code) are
 *    equivalent, so `050…`, `+971 50…` and `971 50…` all match each other. A digits query of ≥3
 *    digits searches phones (`4567` → `+971 50 123 4567`).
 *
 * Ranking: exact (0) → prefix (1) → substring (2); ties broken name → phone → email, then by name.
 */

export type MatchField = 'name' | 'alias' | 'phone' | 'email';

/** A half-open highlight range [start, end) into the ORIGINAL (un-normalised) field value. */
export interface Range {
  start: number;
  end: number;
}

export interface ClientHit<T> {
  client: T;
  /** Which field matched (the strongest, if several did). */
  field: MatchField;
  /** The original value of that field (for display). */
  value: string;
  /** The part(s) to highlight, in the original string. */
  ranges: Range[];
  /** 0 exact, 1 prefix, 2 substring — lower is stronger. */
  rank: number;
}

export interface SearchResult<T> {
  /** False when the query is too short to search (below the min length) — show the full list. */
  active: boolean;
  hits: Array<ClientHit<T>>;
}

export interface SearchableClient {
  name: string;
  /** [P36-6] learned per-client aliases (the name they write under in WhatsApp, a nickname). */
  aliases?: string[];
  phone?: string | null;
  email?: string | null;
}

const DIACRITIC = /[ً-ٰٟ]/; // Arabic harakat + dagger alef
const TATWEEL = 'ـ';

/** Fold a string for comparison AND keep a map from each folded char back to its original index. */
function foldWithMap(input: string): { norm: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === TATWEEL || DIACRITIC.test(ch)) continue; // stripped — emit nothing, keep no map entry
    let c = ch.toLowerCase();
    if (c === 'أ' || c === 'إ' || c === 'آ') c = 'ا';
    else if (c === 'ة') c = 'ه';
    else if (c === 'ى') c = 'ي';
    out.push(c);
    map.push(i);
  }
  return { norm: out.join(''), map };
}

/** The public fold (name/email comparison key). */
export function normalizeArabic(input: string): string {
  return foldWithMap(input).norm;
}

/** Digits only. */
export function digitsOf(input: string): string {
  return input.replace(/\D/g, '');
}

/** Canonical national phone form so the same number written different ways compares equal:
 *  drop a leading `00` international prefix (the digit form of `+`), then a UAE `971` country code,
 *  then a trunk `0`. A non-UAE number (e.g. `0044…` → `44…`) keeps its own country code and so never
 *  collapses onto a UAE number. [CLI-11] */
export function canonicalPhone(digits: string): string {
  let x = digits;
  if (x.startsWith('00')) x = x.slice(2); // 00 == '+' (international dial prefix)
  if (x.startsWith('971')) x = x.slice(3); // UAE country code
  if (x.startsWith('0')) x = x.slice(1); // trunk 0
  return x;
}

/** A query is "digit-like" when it's only digits and phone punctuation (space, +, -, (), .). */
function isDigitQuery(raw: string): boolean {
  return raw.length > 0 && /^[\d\s()+.-]+$/.test(raw);
}

/** rank of a normalized-substring match, or null if no match. */
function textRank(hayNorm: string, needleNorm: string): number | null {
  if (!needleNorm) return null;
  const idx = hayNorm.indexOf(needleNorm);
  if (idx < 0) return null;
  if (hayNorm === needleNorm) return 0;
  if (idx === 0) return 1;
  return 2;
}

/** Find the highlight range in the ORIGINAL via the fold map. */
function foldedRange(original: string, needleNorm: string): Range | null {
  const { norm, map } = foldWithMap(original);
  const idx = norm.indexOf(needleNorm);
  if (idx < 0) return null;
  const start = map[idx]!;
  const lastFolded = idx + needleNorm.length - 1;
  const end = map[lastFolded]! + 1;
  return { start, end };
}

/** Phone highlight: locate the raw query digits within the stored string; fall back to the whole value. */
function phoneRange(originalPhone: string, queryDigits: string): Range {
  // Map each digit char to its index in the original (formatted) phone.
  const digitIdx: number[] = [];
  for (let i = 0; i < originalPhone.length; i++) if (/\d/.test(originalPhone[i]!)) digitIdx.push(i);
  const storedDigits = digitIdx.map((i) => originalPhone[i]).join('');
  const at = storedDigits.indexOf(queryDigits);
  if (at < 0 || queryDigits.length === 0) return { start: 0, end: originalPhone.length }; // 0/971 equivalence → whole value
  return { start: digitIdx[at]!, end: digitIdx[at + queryDigits.length - 1]! + 1 };
}

const FIELD_TIEBREAK: Record<MatchField, number> = { name: 0, alias: 1, phone: 2, email: 3 };

/** Match ONE client; return its strongest field hit, or null. */
function matchClient<T extends SearchableClient>(client: T, raw: string): ClientHit<T> | null {
  const candidates: Array<{ field: MatchField; value: string; ranges: Range[]; rank: number }> = [];

  if (isDigitQuery(raw)) {
    // Digit query → phones only.
    const qDigits = digitsOf(raw);
    const phone = displayPhone(client.phone); // [P46-4] shown in international format
    const r = textRank(canonicalPhone(digitsOf(phone)), canonicalPhone(qDigits));
    if (r !== null) candidates.push({ field: 'phone', value: phone, ranges: [phoneRange(phone, qDigits)], rank: r });
  } else {
    // Text query → name + email (folded, substring).
    const qNorm = normalizeArabic(raw);
    const nameRank = textRank(normalizeArabic(client.name), qNorm);
    if (nameRank !== null) {
      const rg = foldedRange(client.name, qNorm);
      candidates.push({ field: 'name', value: client.name, ranges: rg ? [rg] : [], rank: nameRank });
    }
    // [P36-6] …and the client's aliases, so "Abu Khalid" finds the client he is filed under.
    for (const alias of client.aliases ?? []) {
      const r = textRank(normalizeArabic(alias), qNorm);
      if (r === null) continue;
      const rg = foldedRange(alias, qNorm);
      candidates.push({ field: 'alias', value: alias, ranges: rg ? [rg] : [], rank: r });
    }
    const email = client.email ?? '';
    const emailRank = textRank(normalizeArabic(email), qNorm);
    if (emailRank !== null) {
      const rg = foldedRange(email, qNorm);
      candidates.push({ field: 'email', value: email, ranges: rg ? [rg] : [], rank: emailRank });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.rank - b.rank || FIELD_TIEBREAK[a.field] - FIELD_TIEBREAK[b.field]);
  const best = candidates[0]!;
  return { client, field: best.field, value: best.value, ranges: best.ranges, rank: best.rank };
}

/**
 * The minimum query length before a search runs: 2 characters for text, 3 digits for a phone query.
 * Below this the result is `active: false` and the caller shows the unfiltered (chip-only) list.
 */
export function searchIsActive(rawQuery: string): boolean {
  const raw = rawQuery.trim();
  if (isDigitQuery(raw)) return digitsOf(raw).length >= 3;
  return raw.length >= 2;
}

/** Search the loaded client list. Returns ranked hits (or active:false when the query is too short). */
export function searchClients<T extends SearchableClient>(clients: ReadonlyArray<T>, rawQuery: string): SearchResult<T> {
  const raw = rawQuery.trim();
  if (!searchIsActive(raw)) return { active: false, hits: [] };
  const hits: Array<ClientHit<T>> = [];
  for (const c of clients) {
    const hit = matchClient(c, raw);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => a.rank - b.rank || FIELD_TIEBREAK[a.field] - FIELD_TIEBREAK[b.field] || a.client.name.localeCompare(b.client.name));
  return { active: true, hits };
}
