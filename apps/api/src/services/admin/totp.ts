import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * [P45-1] TOTP (RFC 6238) for admin 2FA: HMAC-SHA1, 30-second steps, 6 digits, the authenticator-app default.
 * node:crypto only (no dependency). A code is accepted one step either side of now (clock drift), and never for a
 * step at or before the last one used (no replay).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (what the authenticator app stores). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeForStep(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

export function totpCode(secret: string, nowMs: number): string {
  return codeForStep(secret, Math.floor(nowMs / STEP_MS));
}

/** The step the code matched (now, or one either side), or null. `lastUsedStep` blocks a replay. */
export function verifyTotp(secret: string, code: string, nowMs: number, lastUsedStep: number | null = null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(nowMs / STEP_MS);
  for (const step of [now, now - 1, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const want = Buffer.from(codeForStep(secret, step));
    if (timingSafeEqual(want, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, email: string): string {
  return `otpauth://totp/${encodeURIComponent('Tovira admin')}:${encodeURIComponent(email)}?secret=${secret}&issuer=Tovira&algorithm=SHA1&digits=6&period=30`;
}
