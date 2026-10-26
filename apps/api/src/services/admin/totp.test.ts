import { describe, it, expect } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, otpauthUrl, totpCode, verifyTotp } from './totp.js';

/** [P45-1] TOTP (RFC 6238, SHA-1, 30 s, 6 digits) for admin 2FA, built on node:crypto only. */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('[P45-1] TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vectors (6-digit form)', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totpCode(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totpCode(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });

  it('base32 round-trips; a new secret is 160 bits', () => {
    const s = generateTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it('accepts the current code and one step either side; returns the step used', () => {
    const now = 1_800_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(Math.floor(now / 30_000));
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 30_000), now)).toBe(Math.floor(now / 30_000) - 1);
  });

  it('NEGATIVE: a code two steps old, a wrong code, a malformed code, or a step already used is refused', () => {
    const now = 1_800_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 60_000), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '000000', now) === null || totpCode(RFC_SECRET, now) === '000000').toBe(true);
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now, step)).toBeNull(); // replay of the same step
  });

  it('otpauth link for an authenticator app (issuer Tovira)', () => {
    expect(otpauthUrl('ABC', 'wabil@tovira.io')).toBe('otpauth://totp/Tovira%20admin:wabil%40tovira.io?secret=ABC&issuer=Tovira&algorithm=SHA1&digits=6&period=30');
  });
});
