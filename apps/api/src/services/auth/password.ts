import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

/**
 * [LOGIN-TIMING] A well-formed placeholder hash for the unknown-account login path. It PARSES
 * (3 parts, non-empty 16-byte salt, a full 64-byte key), so `verify` runs the complete scrypt on it
 * exactly as it would for a real account — closing the timing oracle where the old dummy
 * ('scrypt$00$00') short-circuited before the KDF (making unknown emails answer far faster than
 * real ones). The bytes are arbitrary: no password ever verifies against it. Lives here, with the
 * parser that defines the format, so it can never drift out of sync with `verify`.
 */
export const DUMMY_VERIFY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(KEYLEN * 2)}`;

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, stored: string): Promise<boolean>;
}

/**
 * scrypt-based password hashing (node builtin — no external dependency).
 * Stored form: `scrypt$<saltHex>$<hashHex>`. Verification is constant-time.
 */
export class ScryptHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = (await scryptAsync(plain, salt, KEYLEN)) as Buffer;
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1]!, 'hex');
    const expected = Buffer.from(parts[2]!, 'hex');
    if (salt.length === 0 || expected.length !== KEYLEN) return false;
    const derived = (await scryptAsync(plain, salt, KEYLEN)) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
}
