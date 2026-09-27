/**
 * REDACT-1: the sensitive-data taxonomy + redactor. A single definition used by every
 * ingest path (paste, import, voice) BEFORE text is stored, embedded, sent to a model,
 * or logged. Tier-1 values are NEVER stored — redacted here at the door.
 *
 * False-positive posture is the hard constraint: eating an order quantity or a price is
 * a product bug. So every numeric pattern requires a format anchor (prefix, checksum, or
 * length + keyword) rather than a bare digit run. Card numbers are Luhn-validated; a
 * plain "we ordered 100000 units" or "AED 45000" must pass through untouched.
 */

export type SensitiveKind = 'card' | 'iban' | 'emirates_id' | 'swift' | 'bank_account' | 'passport' | 'credential';

export interface RedactionResult {
  redacted: string;
  /** Per-kind hit counts (values are NEVER recorded — only how many). */
  counts: Record<string, number>;
  total: number;
}

/** Luhn check — cuts most 13–19 digit false positives (real cards pass; random runs don't). */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Arabic-Indic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9) digits map 1:1 to
// ASCII. Normalise first so every pattern below catches a value written in either script —
// this is a multilingual market and `\d` in JS is ASCII-only, so an Emirates ID or IBAN in
// Arabic-Indic numerals would otherwise sail straight through the redactor.
function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.codePointAt(0)!;
    return String((c >= 0x06f0 ? c - 0x06f0 : c - 0x0660));
  });
}

// Separators an obfuscated card/IBAN may carry: ASCII space/tab, newline/CR (a value split across a
// line break within ONE message), dot, NBSP, narrow NBSP, non-breaking hyphen, hyphen. NOT "/" — dates
// use it and are not cards. Luhn + the 13–19 digit length is the real guard, so a generous separator
// set stays false-positive-safe (a 13–19 digit run that happens to satisfy Luhn is a card, not a price).
const SEP = ' \\t\\n\\r.\\u00A0\\u202F\\u2011-';
// Anchored patterns. Order matters: most specific first (Emirates ID before generic runs).
const EMIRATES_ID = /\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g; // 784-YYYY-NNNNNNN-C, dash- or single-space-separated (the 784 prefix + 4/7/1 grouping is the anchor, so spaces don't widen it to ordinary runs)
// UAE IBAN: AE + 21 digits, tolerating whitespace between digits (the usual 4-char groups,
// or broken across a line). AE + exactly 21 digits is an IBAN, never a price or quantity.
const IBAN_AE = /\bAE(?:\s?\d){21}\b/gi;
// Keyworded (foreign) IBAN — allow the common "IBAN no"/"IBAN number" label variant before the value.
const IBAN_KEYWORDED = /\b(?:iban)(?:\s*(?:no|number|#))?\b[:\s]*([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/gi;
// Card: 13–19 digits, optionally grouped by any of the separators above; validated by Luhn.
const CARD_CANDIDATE = new RegExp(`\\b(?:\\d[${SEP}]?){13,19}\\b`, 'g');
// Keyword-anchored credentials/identifiers — require the label so we never eat a bare number. English
// labels keep the \b word-boundary; Arabic labels are listed without \b (Arabic script is not \w, so \b
// would not fire before/after it). Arabic forms are the ones that actually occur in UAE chats: OTP
// (رمز التحقق), password (كلمة المرور/السر), PIN (الرقم السري), and the generic code (الرمز). Bare رمز is
// deliberately excluded — it collides with الرمز البريدي (postal code) and other non-secret uses.
const CREDENTIAL = /(?:\b(?:otp|one[- ]?time (?:code|password)|2fa|pin|password|passcode|api[ -]?key|token|cvv|cvc)\b|رمز التحقق|كلمة المرور|كلمة السر|الرقم السري|الرمز)\s*(?:is|:|=|-)?\s*([A-Za-z0-9._-]{3,})/gi;
const SWIFT = /(?:\b(?:swift|bic)\b|رمز سويفت|كود سويفت|سويفت)[:\s]*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi;
// Bank account — English enumerated + unenumerated ("acct", "bank a/c") labels, plus Arabic (رقم الحساب /
// رقم حساب / حساب بنكي / الحساب). Longest Arabic form first so "رقم الحساب" wins over "الحساب".
const BANK_ACCOUNT = /(?:\b(?:account (?:number|no|#)|acct(?: (?:no|number|#))?|a\/c(?: (?:no|number))?|bank a\/c)\b|رقم الحساب|رقم حساب|حساب بنكي|الحساب)[:\s]*([0-9]{6,20})\b/gi;
// Passport / visa / residency. Bare "licence"/"license" is intentionally NOT a keyword: it caught
// business references (trade/commercial/business licence) as IDs. Only "driving licen[cs]e" (the actual
// ID document) is kept. Arabic: جواز السفر / رقم الجواز / الجواز (passport), الإقامة (residency), تأشيرة (visa).
const PASSPORT = /(?:\b(?:passport|visa|residency|driving licen[cs]e)\b|جواز السفر|رقم الجواز|الجواز|الإقامة|تأشيرة)(?:\s*(?:no|number|#|is|:|-))?\s*([A-Z0-9]{6,12})\b/gi;

function bump(counts: Record<string, number>, kind: SensitiveKind): void {
  counts[kind] = (counts[kind] ?? 0) + 1;
}

/**
 * Redact Tier-1 sensitive values, returning the redacted text + per-kind counts.
 * Placeholders preserve readability + the receipt doctrine (a quote shows the redacted form).
 * Cards keep only the last 4 — enough for the rep to recognise, useless as a card number.
 */
export function redactSensitive(input: string): RedactionResult {
  const counts: Record<string, number> = {};
  let text = normalizeDigits(input);

  text = text.replace(EMIRATES_ID, () => { bump(counts, 'emirates_id'); return '[Emirates ID redacted]'; });
  text = text.replace(IBAN_AE, () => { bump(counts, 'iban'); return '[IBAN redacted]'; });
  text = text.replace(IBAN_KEYWORDED, (m, _v, off: number, s: string) => {
    // keep the "IBAN" label, redact the value
    void _v; void off; void s;
    bump(counts, 'iban');
    return m.replace(/([A-Z]{2}\d{2}[A-Z0-9]{10,30})/i, '[IBAN redacted]');
  });
  text = text.replace(CARD_CANDIDATE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return m; // not a card — leave it
    bump(counts, 'card');
    return `[card ending ${digits.slice(-4)}]`;
  });
  text = text.replace(CREDENTIAL, (m, val: string) => { bump(counts, 'credential'); return m.replace(val, '[credential redacted]'); });
  text = text.replace(SWIFT, (m, val: string) => { bump(counts, 'swift'); return m.replace(val, '[SWIFT redacted]'); });
  text = text.replace(BANK_ACCOUNT, (m, val: string) => { bump(counts, 'bank_account'); return m.replace(val, '[bank account redacted]'); });
  text = text.replace(PASSPORT, (m, val: string) => { bump(counts, 'passport'); return m.replace(val, '[ID redacted]'); });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { redacted: text, counts, total };
}
