import { describe, it, expect } from 'vitest';
import { ScryptHasher } from './password.js';

// [P0-3] Passwords are never stored in plaintext; verification is constant-time.
describe('ScryptHasher', () => {
  const hasher = new ScryptHasher();

  it('produces a hash that is not the plaintext', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies a correct password', async () => {
    const hash = await hasher.hash('s3cret-pw');
    expect(await hasher.verify('s3cret-pw', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('s3cret-pw');
    expect(await hasher.verify('not-it', hash)).toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    const a = await hasher.hash('same');
    const b = await hasher.hash('same');
    expect(a).not.toBe(b);
    expect(await hasher.verify('same', a)).toBe(true);
    expect(await hasher.verify('same', b)).toBe(true);
  });

  it('does not throw on a malformed stored hash — returns false', async () => {
    expect(await hasher.verify('x', 'garbage')).toBe(false);
  });
});
