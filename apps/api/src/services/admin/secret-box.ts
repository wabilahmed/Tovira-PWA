import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** AES-256-GCM seal/open, as "<version>.<iv>.<tag>.<body>" (base64url). */
class Box {
  constructor(private readonly key: Buffer, private readonly version: 'v1' | 'v2') {}
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [this.version, iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }
  open(sealed: string): string {
    const [v, iv, tag, body] = sealed.split('.');
    if (v !== this.version || !iv || !tag || !body) throw new Error('bad sealed secret');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  }
}

/**
 * [P46-6c.1] Encrypts admin TOTP secrets at rest (AES-256-GCM, sealed "v2.…"). The key is derived (HKDF) from the
 * dedicated ADMIN_TOTP_KEY in Secrets Manager: not in the database, and not OPS_TOKEN (a shared script and CI secret),
 * so neither a database copy nor anything holding OPS_TOKEN can read the second factor, and rotating OPS_TOKEN never
 * touches admin 2FA.
 */
export class SecretBox extends Box {
  constructor(adminTotpKey: string) {
    super(Buffer.from(hkdfSync('sha256', adminTotpKey, 'tovira-admin-totp-key', 'aes-256-gcm v2', 32)), 'v2');
  }
}

/**
 * [P45-1 → P46-6c.1] The OLD box ("v1.…", key derived from OPS_TOKEN). Kept ONLY so the deploy-time re-encryption can
 * move an already-enrolled admin to the new key without a new enrolment. Sign-in never uses it: no fallback.
 */
export class LegacySecretBox extends Box {
  constructor(opsToken: string) {
    super(Buffer.from(hkdfSync('sha256', opsToken, 'tovira-admin-totp', 'aes-256-gcm key', 32)), 'v1');
  }
}
