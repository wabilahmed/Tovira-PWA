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
