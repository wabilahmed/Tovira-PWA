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

export type SensitiveKind = 'card' | 'iban' | 'emirates_id' | 'aadhaar' | 'pan' | 'swift' | 'bank_account' | 'passport' | 'credential';

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
  // [P53] and Devanagari (U+0966–096F), for Hindi chats and transcripts
  return s.replace(/[٠-٩۰-۹०-९]/g, (d) => {
    const c = d.codePointAt(0)!;
    return String(c >= 0x0966 ? c - 0x0966 : c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

// [P53] Verhoeff checksum (Aadhaar's check digit): cuts the false hits a bare 12-digit pattern would make.
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
function verhoeffValid(digits: string): boolean {
  let c = 0;
  const r = digits.split('').reverse();
  for (let i = 0; i < r.length; i++) c = VD[c]![VP[i % 8]![Number(r[i])]!]!;
  return c === 0;
}
/** [P53] Aadhaar: 12 digits, the first 2–9, Verhoeff-valid. */
const isAadhaar = (digits: string): boolean => digits.length === 12 && /^[2-9]/.test(digits) && verhoeffValid(digits);

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
// [P53] Aadhaar: 4-4-4 with one consistent separator (space or dash) or run together; never part of a longer number,
// never after "+" (a country code). Checked by isAadhaar (2–9 first, Verhoeff). Runs AFTER the card rule, so it can never
// take the first twelve digits of a card.
const AADHAAR = /(?<!\d[ -]?)(?<!\+)[2-9]\d{3}([ -]?)\d{4}\1\d{4}(?![ -]?\d)/g;
// [P53] PAN (India): 5 letters, 4 digits, 1 letter, any case; the 4th letter is a holder type (P person, C company,
// H HUF, F firm, A AOP, T trust, B BOI, L local authority, J artificial juridical person, G government). A whole token only.
const PAN = /(?<![A-Za-z0-9])[A-Za-z]{3}[ABCFGHJLPTabcfghjlpt][A-Za-z]\d{4}[A-Za-z](?![A-Za-z0-9])/g;
// Card: 13–19 digits, optionally grouped by any of the separators above; validated by Luhn.
const CARD_CANDIDATE = new RegExp(`\\b(?:\\d[${SEP}]?){13,19}\\b`, 'g');
// Keyword-anchored credentials/identifiers — require the label so we never eat a bare number. English
// labels keep the \b word-boundary; Arabic labels are listed without \b (Arabic script is not \w, so \b
// would not fire before/after it). Arabic forms are the ones that actually occur in UAE chats: OTP
// (رمز التحقق), password (كلمة المرور/السر), PIN (الرقم السري), and the generic code (الرمز). Bare رمز is
// deliberately excluded — it collides with الرمز البريدي (postal code) and other non-secret uses.
// [P53 · owner] "PIN code" is a postal code (India), never a secret: "pin" followed by "code" is not a credential label.
// A bare "PIN" with digits stays a secret PIN.
const CREDENTIAL = /(?:\b(?:otp|one[- ]?time (?:code|password)|2fa|pin(?!\s*code\b)|password|passcode|api[ -]?key|token|cvv|cvc)\b|رمز التحقق|كلمة المرور|كلمة السر|الرقم السري|الرمز)\s*(?:is|:|=|-)?\s*([A-Za-z0-9._-]{3,})/gi;
const SWIFT = /(?:\b(?:swift|bic)\b|رمز سويفت|كود سويفت|سويفت)[:\s]*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi;
// Bank account — English enumerated + unenumerated ("acct", "bank a/c") labels, plus Arabic (رقم الحساب /
// رقم حساب / حساب بنكي / الحساب). Longest Arabic form first so "رقم الحساب" wins over "الحساب".
// [P53] + bare "account", "A/C no." (with its period), and Hindi खाता संख्या / खाता नंबर. Still 6–20 digits, still only
// after a label.
const BANK_ACCOUNT = /(?:\b(?:bank a\/c|account|acct|a\/c)(?:\s*(?:number|no|#))?(?![A-Za-z])\.?|رقم الحساب|رقم حساب|حساب بنكي|الحساب|खाता संख्या|खाता नंबर)[:\s]*([0-9]{6,20})\b/gi;
const ACCOUNT_LABEL = /(?:\b(?:account|acct|a\/c)\b|खाता)[^.\n]{0,24}$/i;
// Passport / visa / residency. Bare "licence"/"license" is intentionally NOT a keyword: it caught
// business references (trade/commercial/business licence) as IDs. Only "driving licen[cs]e" (the actual
// ID document) is kept. Arabic: جواز السفر / رقم الجواز / الجواز (passport), الإقامة (residency), تأشيرة (visa).
// [P53] + पासपोर्ट; the label may carry punctuation ("no.", "no:", "number:"); the value needs a digit, so the word "number"
// itself is never taken for the passport.
const PASSPORT = /(?:\b(?:passport|visa|residency|driving licen[cs]e)\b|جواز السفر|رقم الجواز|الجواز|الإقامة|تأشيرة|पासपोर्ट)(?:\s*(?:no\.?|number|#|is)(?![A-Za-z]))?\s*[:-]?\s*((?=[A-Z]*\d)[A-Z0-9]{6,12})\b/gi;
// [P53] An Indian passport (a letter and 7 digits) with "passport" / पासपोर्ट within four words, before or after it.
const IN_PASSPORT = /(?<![A-Za-z0-9])[A-Za-z][1-9]\d{6}(?![A-Za-z0-9])/g;
const PASSPORT_WORD = /passport|पासपोर्ट/i;
function nearPassport(text: string, at: number, len: number): boolean {
  const before = text.slice(0, at).split(/\s+/).filter(Boolean).slice(-5).join(' ');
  const after = text.slice(at + len).split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  return PASSPORT_WORD.test(before) || PASSPORT_WORD.test(after);
}

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
  let text = spokenNumbers(normalizeDigits(input), counts);

  text = text.replace(EMIRATES_ID, () => { bump(counts, 'emirates_id'); return '[Emirates ID redacted]'; });
  text = text.replace(IBAN_AE, () => { bump(counts, 'iban'); return '[IBAN redacted]'; });
  text = text.replace(IBAN_KEYWORDED, (m, _v, off: number, s: string) => {
    // keep the "IBAN" label, redact the value
    void _v; void off; void s;
    bump(counts, 'iban');
    return m.replace(/([A-Z]{2}\d{2}[A-Z0-9]{10,30})/i, '[IBAN redacted]');
  });
  // [P53] a labelled bank account first: its label beats a chance Luhn match (an account is never shown as a card)
  text = text.replace(BANK_ACCOUNT, (m, val: string) => { bump(counts, 'bank_account'); return m.replace(val, '[bank account redacted]'); });
  text = text.replace(CARD_CANDIDATE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return m; // not a card — leave it
    bump(counts, 'card');
    return `[card ending ${digits.slice(-4)}]${/[^\d]*$/.exec(m)![0]}`; // [P50-0] keep the separator the run swallowed
  });
  text = text.replace(AADHAAR, (m) => {
    if (!isAadhaar(m.replace(/\D/g, ''))) return m; // fails the checksum: not an Aadhaar
    bump(counts, 'aadhaar');
    return '[ID redacted]';
  });
  text = text.replace(PAN, () => { bump(counts, 'pan'); return '[ID redacted]'; });
  text = text.replace(CREDENTIAL, (m, val: string) => { bump(counts, 'credential'); return m.replace(val, '[credential redacted]'); });
  text = text.replace(SWIFT, (m, val: string) => { bump(counts, 'swift'); return m.replace(val, '[SWIFT redacted]'); });
  text = text.replace(PASSPORT, (m, val: string) => { bump(counts, 'passport'); return m.slice(0, m.length - val.length) + '[ID redacted]'; });
  text = text.replace(IN_PASSPORT, (m, at: number, whole: string) => (nearPassport(whole, at, m.length) ? (bump(counts, 'passport'), '[ID redacted]') : m));

  // [P50-0] A card split over consecutive messages from one sender, in a raw chat's lines.
  if (text.includes('\n')) {
    const lines = text.split('\n').map(parseChatLine);
    let who: string | null = null;
    const parts = lines.map((l) => { if (l.sender !== null) who = l.sender; return { who: l.sender ?? who, text: l.body }; });
    const joined = joinSplitCards(parts, counts);
    if (joined.changed) text = lines.map((l, i) => l.prefix + joined.texts[i]).join('\n');
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { redacted: text, counts, total };
}

/**
 * [P50-0] Redact an imported chat's messages: each message on its own, then a card number split over consecutive
 * messages from the same sender ("4539 1488" … "0343 6467"), which no single message shows whole.
 */
export function redactMessages<M extends { sender: string; body: string }>(messages: M[]): { messages: M[]; counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {};
  const each = messages.map((m) => {
    const r = redactSensitive(m.body);
    for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + v;
    return r.redacted;
  });
  const joined = joinSplitCards(messages.map((m, i) => ({ who: m.sender, text: each[i]! })), counts);
  const out = messages.map((m, i) => ({ ...m, body: joined.texts[i]! }));
  return { messages: out, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

// ---- [P50-0] a card split over messages ------------------------------------------------------------------------------

// A chat line's header: "[10/06/2026, 09:10] Omar: " (iPhone) or "10/06/2026, 9:10 am - Omar: " (Android). A line without
// one continues the message above it.
const CHAT_HEADER = /^(\s*(?:\[[^\]\n]{1,40}\]\s*(?:-\s*)?|\d{1,2}[/.]\d{1,2}[/.]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:[\s\u202f]?[ap]\.?m\.?)?\s*-\s*)([^:\n]{1,60}):\s?)(.*)$/i;
function parseChatLine(line: string): { prefix: string; sender: string | null; body: string } {
  const m = CHAT_HEADER.exec(line);
  return m ? { prefix: m[1]!, sender: m[2]!.trim(), body: m[3]! } : { prefix: '', sender: null, body: line };
}

const DIGIT_RUN = /\d{2,6}(?:[ .\u00A0-]\d{2,6})*/g;

/** Join digit runs across up to four consecutive parts from one sender: the last run of the first part, any parts that
 *  are nothing but digits, and the first run of the last part. A 13–19 digit Luhn-valid join is a card: every piece is
 *  blanked, the last one keeps the card's last four. */
function joinSplitCards(parts: Array<{ who: string | null; text: string }>, counts: Record<string, number>): { texts: string[]; changed: boolean } {
  const texts = parts.map((p) => p.text);
  let changed = false;
  const runs = (t: string) => [...t.matchAll(DIGIT_RUN)].map((m) => ({ at: m.index!, s: m[0], d: m[0].replace(/\D/g, '') }));
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]!.who === null) continue;
    const first = runs(texts[i]!).at(-1);
    if (!first) continue;
    const pieces: Array<{ part: number; at: number; s: string }> = [{ part: i, ...first }];
    let digits = first.d;
    let aadhaarPieces: { pieces: Array<{ part: number; at: number; s: string }>; end: number } | null = null;
    let cardDone = false;
    for (let k = i + 1; k < parts.length && k <= i + 3 && parts[k]!.who === parts[i]!.who; k++) {
      const head = runs(texts[k]!)[0];
      if (!head) break;
      const candidate = digits + head.d;
      if (candidate.length > 19) break;
      // [P53] an Aadhaar split over messages, unless the chain goes on to complete a card (a card always wins)
      if (isAadhaar(candidate) && !aadhaarPieces) aadhaarPieces = { pieces: [...pieces, { part: k, at: head.at, s: head.s }], end: k };
      if (candidate.length >= 13 && luhnValid(candidate)) {
        pieces.push({ part: k, at: head.at, s: head.s });
        for (const [n, p] of pieces.entries()) {
          const label = n === pieces.length - 1 ? `[card ending ${candidate.slice(-4)}]` : '[card number redacted]';
          texts[p.part] = texts[p.part]!.slice(0, p.at) + label + texts[p.part]!.slice(p.at + p.s.length);
        }
        bump(counts, 'card');
        changed = true;
        cardDone = true;
        i = k;
        break;
      }
      if (texts[k]!.trim() !== head.s) break; // only a part that is nothing but digits can sit in the middle
      pieces.push({ part: k, at: head.at, s: head.s });
      digits = candidate;
    }
    if (!cardDone && aadhaarPieces) {
      for (const p of aadhaarPieces.pieces) texts[p.part] = texts[p.part]!.slice(0, p.at) + '[ID redacted]' + texts[p.part]!.slice(p.at + p.s.length);
      bump(counts, 'aadhaar');
      changed = true;
      i = aadhaarPieces.end;
    }
  }
  return { texts, changed };
}

// ---- [P50-0] numbers read out in words (a voice note) ----------------------------------------------------------------

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  sifr: '0', wahid: '1', wahed: '1', ithnain: '2', itnain: '2', ethnain: '2', thalatha: '3', talata: '3', arba: '4', arbaa: '4', khamsa: '5', sitta: '6', saba: '7', sabaa: '7', thamanya: '8', tamanya: '8', tisa: '9', tisaa: '9',
  'صفر': '0', 'واحد': '1', 'اثنين': '2', 'اثنان': '2', 'إثنين': '2', 'اتنين': '2', 'ثلاثة': '3', 'ثلاث': '3', 'تلاتة': '3', 'أربعة': '4', 'اربعة': '4', 'أربع': '4', 'اربع': '4',
  'خمسة': '5', 'خمس': '5', 'ستة': '6', 'ست': '6', 'سبعة': '7', 'سبع': '7', 'ثمانية': '8', 'ثمانيه': '8', 'ثمان': '8', 'تمانية': '8', 'تسعة': '9', 'تسع': '9',
};
const REPEAT: Record<string, number> = { double: 2, triple: 3 };
const WORD = `(?:${[...Object.keys(NUMBER_WORDS), ...Object.keys(REPEAT)].sort((a, b) => b.length - a.length).join('|')})`;
const SPOKEN_RUN = new RegExp(`(?<![\\p{L}\\p{N}])${WORD}(?:[\\s,،.-]+${WORD})+(?![\\p{L}\\p{N}])`, 'giu');

/** A run of 7+ number words that spells an Emirates ID (15 digits, 784 first) or a card (13–19 digits, Luhn) is blanked
 *  like the digits would be. Anything else (a phone number, a quantity) is left as said. */
function spokenNumbers(text: string, counts: Record<string, number>): string {
  return text.replace(SPOKEN_RUN, (run, at: number, whole: string) => {
    const words = run.toLowerCase().split(/[\s,،.-]+/).filter(Boolean);
    let digits = '';
    for (let i = 0; i < words.length; i++) {
      const rep = REPEAT[words[i]!];
      if (rep && NUMBER_WORDS[words[i + 1] ?? '']) { digits += NUMBER_WORDS[words[i + 1]!]!.repeat(rep); i++; continue; }
      const d = NUMBER_WORDS[words[i]!];
      if (d === undefined) return run;
      digits += d;
    }
    if (digits.length < 7) return run;
    if (digits.length === 15 && digits.startsWith('784')) { bump(counts, 'emirates_id'); return '[Emirates ID redacted]'; }
    if (isAadhaar(digits)) { bump(counts, 'aadhaar'); return '[ID redacted]'; } // [P53]
    // [P53] a bank account read out right after an account label ("his account number is one two three…")
    if (digits.length >= 9 && digits.length <= 18 && ACCOUNT_LABEL.test(whole.slice(Math.max(0, at - 40), at))) { bump(counts, 'bank_account'); return '[bank account redacted]'; }
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) { bump(counts, 'card'); return `[card ending ${digits.slice(-4)}]`; }
    return run;
  });
}
