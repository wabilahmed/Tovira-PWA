import { describe, it, expect } from 'vitest';
import { redactSensitive } from './redact.js';

describe('[REDACT-1] redactSensitive — Tier-1 values never survive', () => {
  it('redacts a Luhn-valid card, keeping only the last 4', () => {
    const r = redactSensitive('here is my card 4539 1488 0343 6467 thanks');
    expect(r.redacted).toContain('[card ending 6467]');
    expect(r.redacted).not.toMatch(/4539|1488|0343/);
    expect(r.counts.card).toBe(1);
  });

  it('redacts a UAE IBAN and an Emirates ID', () => {
    const r = redactSensitive('pay to AE070331234567890123456 and my EID is 784-1990-1234567-1');
    expect(r.redacted).toContain('[IBAN redacted]');
    expect(r.redacted).toContain('[Emirates ID redacted]');
    expect(r.redacted).not.toMatch(/AE0703|784-1990/);
  });

  it('redacts keyword-anchored credentials (OTP, PIN, password, token)', () => {
    const r = redactSensitive('your OTP is 448192, pin: 4471, password = hunter2, api key sk-abc123def');
    expect(r.redacted).not.toMatch(/448192|4471|hunter2|sk-abc123def/);
    expect(r.counts.credential).toBeGreaterThanOrEqual(3);
  });

  it('redacts a keyworded bank account and SWIFT/BIC', () => {
    const r = redactSensitive('account number: 12345678901 SWIFT: NBADAEAAXXX');
    expect(r.redacted).not.toMatch(/12345678901|NBADAEAAXXX/);
  });

  // ── FALSE-POSITIVE GUARD: over-redaction is a product bug. These must pass through. ──
  it('does NOT redact order quantities, prices, phone numbers, or long order refs', () => {
    const r = redactSensitive('we ordered 100000 units at AED 45000, ref ORD-20260901-0042, call +971 50 123 4567');
    expect(r.redacted).toBe('we ordered 100000 units at AED 45000, ref ORD-20260901-0042, call +971 50 123 4567');
    expect(r.total).toBe(0);
  });

  it('does NOT redact a 16-digit number that fails Luhn (not a card)', () => {
    const r = redactSensitive('the reference is 1234567812345678');
    expect(r.redacted).toContain('1234567812345678'); // fails Luhn → left alone
    expect(r.counts.card ?? 0).toBe(0);
  });

  it('a bare short number is untouched (a date, a quantity)', () => {
    const r = redactSensitive('meeting on 05/06/2026, 12 attendees, 20th floor');
    expect(r.total).toBe(0);
  });
});

// ADVERSARIAL: redact.ts now carries the whole leakage gate (the eval tests the prod
// pipeline — values are stripped before the model). So the regex is the single point of
// failure and must survive real-world obfuscation, especially from WhatsApp exports and
// this multilingual market. A Tier-1 value in any of these forms must NOT survive.
describe('[REDACT-1] adversarial evasions — the deterministic layer must hold', () => {
  const cardDigits = '4539148803436467'; // Luhn-valid test card (same as the fixtures)

  it('catches a dashed card (last 4 kept by design)', () => {
    const r = redactSensitive('card 4539-1488-0343-6467 ok');
    expect(r.redacted).not.toMatch(/4539|1488|0343/); // 6467 is the kept last-4
    expect(r.redacted).toContain('[card ending 6467]');
    expect(r.counts.card).toBe(1);
  });

  it('catches a card written with non-standard single separators (WhatsApp)', () => {
    // Realistic single separators a paste may carry: space, dot, NBSP, non-breaking hyphen.
    for (const sep of [' ', '.', ' ', '‑']) {
      const grouped = cardDigits.match(/.{1,4}/g)!.join(sep);
      const r = redactSensitive(`paid with ${grouped} today`);
      expect(r.redacted, `separator U+${sep.charCodeAt(0).toString(16)}`).not.toContain('4539');
    }
  });

  it('catches a UAE IBAN written in the usual 4-char groups', () => {
    const r = redactSensitive('transfer to AE07 0331 2345 6789 0123 456 please');
    expect(r.redacted).not.toMatch(/AE07 0331|0331 2345|2345 6789/);
    expect(r.counts.iban).toBe(1);
  });

  it('catches a UAE IBAN broken across a line', () => {
    const r = redactSensitive('IBAN AE0703312345678\n90123456 is where to pay');
    expect(r.redacted).not.toContain('AE0703312345678');
    expect(r.counts.iban).toBe(1);
  });

  it('catches a lowercase IBAN', () => {
    const r = redactSensitive('send to ae070331234567890123456 now');
    expect(r.redacted).not.toMatch(/ae0703|AE0703/i);
    expect(r.counts.iban).toBe(1);
  });

  it('catches an Emirates ID written in Arabic-Indic numerals', () => {
    // ٤ etc. = 784-1990-1234567-1 in Arabic-Indic digits
    const eid = '٧٨٤-١٩٩٠-١٢٣٤٥٦٧-١';
    const r = redactSensitive(`ID ${eid} thanks`);
    expect(r.redacted).toContain('[Emirates ID redacted]');
    expect(r.counts.emirates_id).toBe(1);
  });

  it('still does NOT over-redact after hardening (order qty / price / ref survive)', () => {
    const r = redactSensitive('ordered 100000 units at AED 45000, ref ORD-20260901-0042');
    expect(r.total).toBe(0);
  });
});
