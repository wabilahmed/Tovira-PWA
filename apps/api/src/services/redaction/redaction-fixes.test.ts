import { describe, it, expect } from 'vitest';
import { CORPUS, evaluateCase } from './redaction-corpus.js';

/**
 * [REDACT-MEASURE] Task 5 — proves the five cheap fixes. Each id below is a case that was a documented
 * MISS (or the one false positive) at the 2026-09-27 pin, and must now be handled correctly. Written
 * before the detector change: it FAILS on the pre-fix redactor and passes once redact.ts is fixed.
 * Structural gaps (bare unlabelled values, separated labels, cross-message splits, non-Luhn cards) are
 * deliberately NOT here — they stay in KNOWN_GAPS.
 */

// Must now REDACT (identifier value gone). Existing documented misses + researched-form additions.
const NOW_REDACTED = [
  'eid-spaces',          // item 1: SPACE separators in an Emirates ID
  'card-newline',        // item 2: card digits split across a line break within one message
  'pass-arabic-label',   // item 3: جواز السفر
  'pass-arabic-iqama',   // item 3: الإقامة
  'pass-arabic-visa',    // item 3: تأشيرة
  'acct-arabic',         // item 3: رقم الحساب
  'acct-arabic-hisab',   // item 3: الحساب
  'cred-arabic',         // item 3: الرمز
  'cred-arabic-otp',     // item 3: رمز التحقق
  'cred-arabic-pin',     // item 3: الرقم السري
  'cred-arabic-pwd',     // item 3: كلمة المرور
  'swift-arabic',        // item 3: سويفت
  'swift-arabic-code',   // item 3: رمز سويفت
  'acct-acct',           // item 4: unenumerated label "acct"
  'acct-bank-ac-en',     // item 4: "bank a/c"
  'iban-no-en',          // item 4: "IBAN no"
];

// Must now PASS (survive untouched). The one pre-fix FP + Arabic near-miss controls the fix must not break.
const NOW_PASSING = [
  'ctl-tradelicence',    // item 5: "trade licence 654321" must no longer be redacted
  'ctl-arabic-postal',   // item 3 guard: الرمز البريدي (postal code) must not redact
  'ctl-arabic-acct-word', // item 3 guard: الحساب الجاري (no number) must not redact
];

const byId = new Map(CORPUS.map((c) => [c.id, c]));

describe('[REDACT-MEASURE] Task 5 cheap-fix targets', () => {
  it.each(NOW_REDACTED)('redacts %s', (id) => {
    const c = byId.get(id);
    expect(c, `corpus is missing case ${id}`).toBeDefined();
    const { caught, redacted } = evaluateCase(c!);
    expect(caught, `expected "${c!.input}" to have its value removed, got "${redacted}"`).toBe(true);
  });

  it.each(NOW_PASSING)('leaves %s untouched (no false positive)', (id) => {
    const c = byId.get(id);
    expect(c, `corpus is missing case ${id}`).toBeDefined();
    const { caught, redacted } = evaluateCase(c!);
    expect(caught, `expected "${c!.input}" to pass untouched, but it became "${redacted}"`).toBe(true);
  });
});
