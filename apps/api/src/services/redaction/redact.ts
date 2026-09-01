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

// Anchored patterns. Order matters: most specific first (Emirates ID before generic runs).
const EMIRATES_ID = /\b784-?\d{4}-?\d{7}-?\d\b/g; // 784-YYYY-NNNNNNN-C
const IBAN_AE = /\bAE\d{21}\b/gi; // UAE IBAN: AE + 21 digits
const IBAN_KEYWORDED = /\b(?:iban)\b[:\s]*([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/gi;
// Card: 13–19 digits, optionally grouped by spaces/dashes; validated by Luhn.
const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;
// Keyword-anchored credentials/identifiers — require the label so we never eat a bare number.
const CREDENTIAL = /\b(?:otp|one[- ]?time (?:code|password)|2fa|pin|password|passcode|api[ -]?key|token|cvv|cvc)\b\s*(?:is|:|=|-)?\s*([A-Za-z0-9._-]{3,})/gi;
const SWIFT = /\b(?:swift|bic)\b[:\s]*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi;
const BANK_ACCOUNT = /\b(?:account (?:number|no|#)|a\/c (?:no|number)?)\b[:\s]*([0-9]{6,20})\b/gi;
const PASSPORT = /\b(?:passport|visa|residency|driving licen[cs]e|licence|license)\b(?:\s*(?:no|number|#|is|:|-))?\s*([A-Z0-9]{6,12})\b/gi;

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
  let text = input;

  text = text.replace(EMIRATES_ID, () => { bump(counts, 'emirates_id'); return '[Emirates ID redacted]'; });
  text = text.replace(IBAN_AE, () => { bump(counts, 'iban'); return '[IBAN redacted]'; });
  text = text.replace(IBAN_KEYWORDED, (m, _v, off: number, s: string) => {
    // keep the "IBAN" label, redact the value
    void _v; void off; void s;
    bump(counts, 'iban');
    return m.replace(/([A-Z]{2}\d{2}[A-Z0-9]{10,30})/i, '[IBAN redacted]');
  });
  text = text.replace(CARD_CANDIDATE, (m) => {
    const digits = m.replace(/[ -]/g, '');
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
