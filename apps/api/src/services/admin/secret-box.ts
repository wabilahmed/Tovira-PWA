import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * [P45-1] Encrypts admin TOTP secrets at rest (AES-256-GCM). The key is derived (HKDF) from a server secret that is
 * NOT in the database (OPS_TOKEN, from Secrets Manager), so a database copy alone can't read the second factor.
 * Rotating that secret means re-enrolling 2FA.
 */
export class SecretBox {
  private readonly key: Buffer;
  constructor(serverSecret: string) {
    this.key = Buffer.from(hkdfSync('sha256', serverSecret, 'tovira-admin-totp', 'aes-256-gcm key', 32));
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }
  open(sealed: string): string {
    const [v, iv, tag, body] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || !body) throw new Error('bad sealed secret');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  }
}
