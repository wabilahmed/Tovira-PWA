import { redactSensitive, type SensitiveKind } from './redact.js';

/** Arabic-Indic + Extended Arabic-Indic → ASCII (mirrors redact.ts::normalizeDigits) so a "caught"
 *  check on an Arabic-digit value compares like-for-like against the (normalised) redacted output. */
export const normDigits = (s: string): string => s.replace(/[٠-٩۰-۹]/g, (d) => { const c = d.codePointAt(0)!; return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660); });

export interface CaseOutcome { c: RedactionCase; caught: boolean; firedKinds: string[]; redacted: string }

/** caught = a real identifier's value is gone (redact case), or a control survived untouched (pass case). */
export function evaluateCase(c: RedactionCase): CaseOutcome {
  const r = redactSensitive(c.input);
  const firedKinds = Object.keys(r.counts).filter((k) => (r.counts[k] ?? 0) > 0);
  const caught = c.expect === 'redact' ? !normDigits(r.redacted).includes(normDigits(c.value ?? '\u0000nope')) : r.total === 0;
  return { c, caught, firedKinds, redacted: r.redacted };
}

/**
 * [REDACT-MEASURE] A hand-built, labelled corpus for measuring redaction accuracy in BOTH directions
 * (misses and false positives). It is a COVERAGE set, not a random sample: redaction is deterministic, so
 * each case is a specific format that a pattern either matches or does not — statistical sampling adds
 * nothing. Cases are chosen to exercise the known failure modes counsel asked about, especially the
 * keyword-dependency of the four keyword-anchored kinds and the messy real-world shapes a UAE chat
 * produces. Redaction sees ONE MESSAGE AT A TIME (import maps each message body through redactSensitive
 * independently), so `crossMessage` cases model the message as redaction actually sees it — alone.
 */
export type Group = 'format-anchored' | 'keyword-anchored' | 'control';

export interface RedactionCase {
  id: string;
  kind: SensitiveKind | 'control';
  group: Group;
  input: string;
  /** 'redact' = a real identifier that SHOULD be removed. 'pass' = legitimate content that must survive. */
  expect: 'redact' | 'pass';
  /** For 'redact' cases: the verbatim value that must be gone from the output (digit-normalised when checked). */
  value?: string;
  /** True when the value/label is split across messages — modelled as the single message redaction sees. */
  crossMessage?: boolean;
  note: string;
}

export const CORPUS: RedactionCase[] = [
  // ── FORMAT-ANCHORED (3 kinds): Emirates ID, IBAN, card ──────────────────────────────────────────
  // Emirates ID (784-YYYY-NNNNNNN-C)
  { id: 'eid-dashes', kind: 'emirates_id', group: 'format-anchored', input: 'ID 784-1985-1234567-1 on file', expect: 'redact', value: '784-1985-1234567-1', note: 'canonical dashed form' },
  { id: 'eid-nodash', kind: 'emirates_id', group: 'format-anchored', input: 'id 784198512345671', expect: 'redact', value: '784198512345671', note: 'no separators' },
  { id: 'eid-spaces', kind: 'emirates_id', group: 'format-anchored', input: 'id 784 1985 1234567 1', expect: 'redact', value: '784 1985 1234567 1', note: 'SPACE separators — the pattern only tolerates dashes' },
  { id: 'eid-arabic', kind: 'emirates_id', group: 'format-anchored', input: 'الهوية ٧٨٤-١٩٨٥-١٢٣٤٥٦٧-١', expect: 'redact', value: '٧٨٤-١٩٨٥-١٢٣٤٥٦٧-١', note: 'Arabic-Indic digits, dashed' },
  { id: 'eid-arabic-nodash', kind: 'emirates_id', group: 'format-anchored', input: 'رقم ٧٨٤١٩٨٥١٢٣٤٥٦٧١', expect: 'redact', value: '٧٨٤١٩٨٥١٢٣٤٥٦٧١', note: 'Arabic-Indic digits, no separators' },
  { id: 'eid-midsentence', kind: 'emirates_id', group: 'format-anchored', input: 'please keep 784-1985-1234567-1 for the tenancy', expect: 'redact', value: '784-1985-1234567-1', note: 'embedded mid-sentence' },
  { id: 'eid-split-msg2', kind: 'emirates_id', group: 'format-anchored', crossMessage: true, input: '4567-1', expect: 'redact', value: '4567-1', note: 'tail half of an EID sent as its own message; head (784-1985-123) was the prior message' },
  // Card (13–19 digits, Luhn-validated; last 4 deliberately kept)
  { id: 'card-spaces', kind: 'card', group: 'format-anchored', input: 'card 4111 1111 1111 1111', expect: 'redact', value: '4111 1111 1111 1111', note: 'Visa test number, space groups (Luhn-valid)' },
  { id: 'card-dashes', kind: 'card', group: 'format-anchored', input: 'card 4111-1111-1111-1111', expect: 'redact', value: '4111-1111-1111-1111', note: 'dash groups' },
  { id: 'card-unseparated', kind: 'card', group: 'format-anchored', input: 'card 4111111111111111', expect: 'redact', value: '4111111111111111', note: 'unseparated' },
  { id: 'card-mastercard', kind: 'card', group: 'format-anchored', input: 'pay to 5500 0000 0000 0004', expect: 'redact', value: '5500 0000 0000 0004', note: 'Mastercard test number (Luhn-valid)' },
  { id: 'card-arabic', kind: 'card', group: 'format-anchored', input: 'البطاقة ٤١١١ ١١١١ ١١١١ ١١١١', expect: 'redact', value: '٤١١١ ١١١١ ١١١١ ١١١١', note: 'Arabic-Indic digits' },
  { id: 'card-typo', kind: 'card', group: 'format-anchored', input: 'card 4111 1111 1111 1112', expect: 'redact', value: '4111 1111 1111 1112', note: "stray typo'd digit — fails Luhn" },
  { id: 'card-split-msg2', kind: 'card', group: 'format-anchored', crossMessage: true, input: '1111 1111', expect: 'redact', value: '1111 1111', note: 'second half of a card split across two messages (8 digits alone)' },
  { id: 'card-newline', kind: 'card', group: 'format-anchored', input: 'card 4111 1111\n1111 1111', expect: 'redact', value: '4111 1111\n1111 1111', note: 'digits split across a line break WITHIN one message (newline not a card separator)' },
  // IBAN (AE + 21 digits; keyworded foreign)
  { id: 'iban-fours', kind: 'iban', group: 'format-anchored', input: 'IBAN AE07 0331 2345 6789 0123 456', expect: 'redact', value: 'AE07 0331 2345 6789 0123 456', note: 'spaced in fours' },
  { id: 'iban-lower', kind: 'iban', group: 'format-anchored', input: 'ae070331234567890123456 is mine', expect: 'redact', value: 'ae070331234567890123456', note: 'lowercase prefix, run together' },
  { id: 'iban-runtogether', kind: 'iban', group: 'format-anchored', input: 'AE070331234567890123456', expect: 'redact', value: 'AE070331234567890123456', note: 'uppercase run together' },
  { id: 'iban-arabic', kind: 'iban', group: 'format-anchored', input: 'AE٠٧٠٣٣١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦', expect: 'redact', value: 'AE٠٧٠٣٣١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦', note: 'Arabic-Indic digits after AE' },
  { id: 'iban-newline', kind: 'iban', group: 'format-anchored', input: 'AE07 0331 2345\n6789 0123 456', expect: 'redact', value: 'AE07 0331 2345\n6789 0123 456', note: 'split across a line break within one message (\\s tolerates newline)' },
  { id: 'iban-foreign-kw', kind: 'iban', group: 'format-anchored', input: 'IBAN: GB29NWBK60161331926819', expect: 'redact', value: 'GB29NWBK60161331926819', note: 'foreign IBAN via the iban keyword' },

  // ── KEYWORD-ANCHORED (4 kinds): each with labelled / bare / separated / unenumerated-label ─────────
  // Passport / visa / licence
  { id: 'pass-labelled', kind: 'passport', group: 'keyword-anchored', input: 'passport no A1234567', expect: 'redact', value: 'A1234567', note: 'labelled' },
  { id: 'visa-labelled', kind: 'passport', group: 'keyword-anchored', input: 'visa number 12345678', expect: 'redact', value: '12345678', note: 'visa label' },
  { id: 'licence-labelled', kind: 'passport', group: 'keyword-anchored', input: 'driving licence 987654', expect: 'redact', value: '987654', note: 'licence label' },
  { id: 'pass-us', kind: 'passport', group: 'keyword-anchored', input: 'US passport 490123456', expect: 'redact', value: '490123456', note: 'US 9-digit passport, labelled' },
  { id: 'pass-bare', kind: 'passport', group: 'keyword-anchored', input: 'A1234567', expect: 'redact', value: 'A1234567', note: 'BARE passport number, NO label anywhere' },
  { id: 'pass-separated', kind: 'passport', group: 'keyword-anchored', input: 'his passport, which he renewed last year, is A1234567', expect: 'redact', value: 'A1234567', note: 'label present but separated from the value by words' },
  { id: 'pass-arabic-label', kind: 'passport', group: 'keyword-anchored', input: 'جواز السفر A1234567', expect: 'redact', value: 'A1234567', note: 'Arabic label (جواز السفر = passport), Latin value' },
  // Bank account
  { id: 'acct-labelled', kind: 'bank_account', group: 'keyword-anchored', input: 'account number 12345678', expect: 'redact', value: '12345678', note: 'labelled' },
  { id: 'acct-ac', kind: 'bank_account', group: 'keyword-anchored', input: 'a/c 12345678', expect: 'redact', value: '12345678', note: 'a/c label' },
  { id: 'acct-bare', kind: 'bank_account', group: 'keyword-anchored', input: '12345678', expect: 'redact', value: '12345678', note: 'BARE account number, NO label' },
  { id: 'acct-separated', kind: 'bank_account', group: 'keyword-anchored', input: 'the account I mentioned earlier is 12345678', expect: 'redact', value: '12345678', note: 'label ("account") separated from value by words' },
  { id: 'acct-acct', kind: 'bank_account', group: 'keyword-anchored', input: 'acct 12345678', expect: 'redact', value: '12345678', note: 'unenumerated label "acct"' },
  { id: 'acct-arabic', kind: 'bank_account', group: 'keyword-anchored', input: 'رقم الحساب 12345678', expect: 'redact', value: '12345678', note: 'Arabic label (رقم الحساب = account number)' },
  { id: 'acct-crossmsg', kind: 'bank_account', group: 'keyword-anchored', crossMessage: true, input: '12345678', expect: 'redact', value: '12345678', note: 'value sent as its own message; the label "account number:" was the prior message' },
  // Credential
  { id: 'cred-otp', kind: 'credential', group: 'keyword-anchored', input: 'OTP is 448291', expect: 'redact', value: '448291', note: 'OTP labelled' },
  { id: 'cred-pin', kind: 'credential', group: 'keyword-anchored', input: 'pin: 4321', expect: 'redact', value: '4321', note: 'pin labelled' },
  { id: 'cred-pwd', kind: 'credential', group: 'keyword-anchored', input: 'password: Hunter2!', expect: 'redact', value: 'Hunter2!', note: 'password labelled' },
  { id: 'cred-cvv', kind: 'credential', group: 'keyword-anchored', input: 'cvv 123', expect: 'redact', value: '123', note: 'cvv labelled' },
  { id: 'cred-bare', kind: 'credential', group: 'keyword-anchored', input: '448291', expect: 'redact', value: '448291', note: 'BARE OTP-looking value, NO label' },
  { id: 'cred-separated', kind: 'credential', group: 'keyword-anchored', input: 'the code I mentioned, it is 448291', expect: 'redact', value: '448291', note: 'only bare "code" (not an enumerated keyword), separated' },
  { id: 'cred-arabic', kind: 'credential', group: 'keyword-anchored', input: 'الرمز 448291', expect: 'redact', value: '448291', note: 'Arabic label (الرمز = the code/OTP)' },
  // SWIFT / BIC
  { id: 'swift-labelled', kind: 'swift', group: 'keyword-anchored', input: 'SWIFT: ADCBAEAA', expect: 'redact', value: 'ADCBAEAA', note: 'SWIFT labelled (8-char BIC)' },
  { id: 'bic-labelled', kind: 'swift', group: 'keyword-anchored', input: 'BIC ADCBAEAAXXX', expect: 'redact', value: 'ADCBAEAAXXX', note: '11-char BIC via BIC label' },
  { id: 'swift-bare', kind: 'swift', group: 'keyword-anchored', input: 'ADCBAEAA', expect: 'redact', value: 'ADCBAEAA', note: 'BARE BIC, NO label' },
  { id: 'swift-arabic', kind: 'swift', group: 'keyword-anchored', input: 'سويفت ADCBAEAA', expect: 'redact', value: 'ADCBAEAA', note: 'Arabic label (سويفت = SWIFT)' },

  // ── TASK 5 additions: researched Arabic label forms + English unenumerated labels (items 3 & 4) ──────
  // Passport/visa — researched forms beyond جواز السفر
  { id: 'pass-arabic-iqama', kind: 'passport', group: 'keyword-anchored', input: 'الإقامة A2345678', expect: 'redact', value: 'A2345678', note: 'Arabic residency-visa label (الإقامة), ubiquitous in the UAE' },
  { id: 'pass-arabic-visa', kind: 'passport', group: 'keyword-anchored', input: 'تأشيرة 87654321', expect: 'redact', value: '87654321', note: 'Arabic visa label (تأشيرة)' },
  // Bank — researched forms + English unenumerated label
  { id: 'acct-arabic-hisab', kind: 'bank_account', group: 'keyword-anchored', input: 'الحساب 87654321', expect: 'redact', value: '87654321', note: 'Arabic label (الحساب = the account)' },
  { id: 'acct-bank-ac-en', kind: 'bank_account', group: 'keyword-anchored', input: 'bank a/c 11223344', expect: 'redact', value: '11223344', note: 'English unenumerated label "bank a/c"' },
  // Credential — researched forms (OTP/PIN/password) that dominate real labels
  { id: 'cred-arabic-otp', kind: 'credential', group: 'keyword-anchored', input: 'رمز التحقق 559182', expect: 'redact', value: '559182', note: 'Arabic OTP label (رمز التحقق = verification code) — the standard UAE bank-SMS wording' },
  { id: 'cred-arabic-pin', kind: 'credential', group: 'keyword-anchored', input: 'الرقم السري 4321', expect: 'redact', value: '4321', note: 'Arabic PIN label (الرقم السري = secret number)' },
  { id: 'cred-arabic-pwd', kind: 'credential', group: 'keyword-anchored', input: 'كلمة المرور Hunter2!', expect: 'redact', value: 'Hunter2!', note: 'Arabic password label (كلمة المرور)' },
  // SWIFT — researched form
  { id: 'swift-arabic-code', kind: 'swift', group: 'keyword-anchored', input: 'رمز سويفت ADCBAEAA', expect: 'redact', value: 'ADCBAEAA', note: 'Arabic SWIFT-code label (رمز سويفت)' },
  // IBAN — English unenumerated label variant
  { id: 'iban-no-en', kind: 'iban', group: 'format-anchored', input: 'IBAN no GB29NWBK60161331926819', expect: 'redact', value: 'GB29NWBK60161331926819', note: 'foreign IBAN via "IBAN no" label variant' },

  // ── CONTROLS: must NOT be caught (a false positive here is a product defect) ────────────────────────
  { id: 'ctl-price1', kind: 'control', group: 'control', input: 'the villa is AED 4,500,000', expect: 'pass', note: 'price in AED' },
  { id: 'ctl-price2', kind: 'control', group: 'control', input: 'budget 45000 AED', expect: 'pass', note: 'price, no separators' },
  { id: 'ctl-price3', kind: 'control', group: 'control', input: 'asking 12,500,000', expect: 'pass', note: 'large price' },
  { id: 'ctl-price-arabic', kind: 'control', group: 'control', input: 'السعر ٤٥٠٠٠٠٠ درهم', expect: 'pass', note: 'Arabic-Indic price (also tests digit normalisation is not a redaction)' },
  { id: 'ctl-plot', kind: 'control', group: 'control', input: 'plot 4721 in the community', expect: 'pass', note: 'plot number' },
  { id: 'ctl-unit', kind: 'control', group: 'control', input: 'unit 1204, tower B', expect: 'pass', note: 'unit number' },
  { id: 'ctl-apt', kind: 'control', group: 'control', input: 'apartment 3305 on floor 12', expect: 'pass', note: 'apartment + floor numbers' },
  { id: 'ctl-area', kind: 'control', group: 'control', input: '2,300 sqft, 3 bed', expect: 'pass', note: 'area in sqft' },
  { id: 'ctl-phone1', kind: 'control', group: 'control', input: 'call me on +971 50 123 4567', expect: 'pass', note: 'UAE mobile, spaced' },
  { id: 'ctl-phone2', kind: 'control', group: 'control', input: 'mobile 0501234567', expect: 'pass', note: 'UAE mobile, local' },
  { id: 'ctl-phone3', kind: 'control', group: 'control', input: 'landline +9714 123 4567', expect: 'pass', note: 'UAE landline' },
  { id: 'ctl-date1', kind: 'control', group: 'control', input: 'handover 15/11/2026', expect: 'pass', note: 'date dd/mm/yyyy' },
  { id: 'ctl-date2', kind: 'control', group: 'control', input: 'signed 2026-11-15', expect: 'pass', note: 'date iso' },
  { id: 'ctl-date3', kind: 'control', group: 'control', input: 'due 15.11.2026', expect: 'pass', note: 'date dotted' },
  { id: 'ctl-cheque', kind: 'control', group: 'control', input: 'cheque 100237 cleared', expect: 'pass', note: 'cheque number (ordinary business ref)' },
  { id: 'ctl-tradelicence', kind: 'control', group: 'control', input: 'trade licence 654321 for the SPV', expect: 'pass', note: 'TRADE LICENCE as an ordinary business reference' },
  { id: 'ctl-ref16-a', kind: 'control', group: 'control', input: 'order ref 9273641058224671', expect: 'pass', note: '16-digit non-card reference (should pass unless it accidentally satisfies Luhn)' },
  { id: 'ctl-ref16-b', kind: 'control', group: 'control', input: 'tracking 1002003004005006', expect: 'pass', note: 'another 16-digit non-card reference' },
  { id: 'ctl-last4', kind: 'control', group: 'control', input: 'the card ending 4421 was declined', expect: 'pass', note: "a card's last four — deliberately kept" },
  // Task 5: Arabic near-miss controls — the new Arabic credential/bank labels must NOT fire on these.
  { id: 'ctl-arabic-postal', kind: 'control', group: 'control', input: 'الرمز البريدي 12345 دبي', expect: 'pass', note: 'postal code (الرمز البريدي) — الرمز is followed by an Arabic word, not a Latin/digit value, so must not redact' },
  { id: 'ctl-arabic-acct-word', kind: 'control', group: 'control', input: 'الحساب الجاري نشط', expect: 'pass', note: 'the current account is active (الحساب + Arabic word, no number) — must not redact' },
];
