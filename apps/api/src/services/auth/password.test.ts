import { describe, it, expect } from 'vitest';
import { ScryptHasher, DUMMY_VERIFY_HASH } from './password.js';

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

  it('DUMMY_VERIFY_HASH is well-formed (parses) and no password verifies against it', async () => {
    expect(DUMMY_VERIFY_HASH.split('$')).toHaveLength(3);
    expect(await hasher.verify('anything', DUMMY_VERIFY_HASH)).toBe(false); // never a real match
  });
});

// [LOGIN-TIMING] The unknown-account login path must do EQUIVALENT work to the known path, or response
// timing enumerates accounts. Tested EMPIRICALLY — sample both paths and compare distributions — not by
// asserting code shape (a shape assertion cannot catch a KDF that quietly stops running).
describe('[LOGIN-TIMING] the unknown-account verify runs the full KDF (no timing oracle)', () => {
  const hasher = new ScryptHasher();
  const SAMPLES = 25;
  const OLD_VULNERABLE_DUMMY = 'scrypt$00$00'; // the pre-fix placeholder that short-circuited the KDF

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };
  async function medianVerifyMs(stored: string): Promise<number> {
    const times: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      await hasher.verify('some-wrong-password', stored);
      times.push(performance.now() - t0);
    }
    return median(times);
  }

  it('unknown-account (DUMMY_VERIFY_HASH) timing matches a real hash; the OLD dummy is detectably faster', async () => {
    const realHash = await hasher.hash('the-real-users-password');
    // warm-up (JIT / first-call cost shouldn't skew the medians)
    await medianVerifyMs(realHash);

    const known = await medianVerifyMs(realHash);            // a real account, wrong password → full scrypt
    const fixedDummy = await medianVerifyMs(DUMMY_VERIFY_HASH); // unknown account, AFTER the fix → full scrypt
    const oldDummy = await medianVerifyMs(OLD_VULNERABLE_DUMMY); // unknown account, BEFORE the fix → short-circuit

    // The fixed unknown path does comparable work to a real verify (both run one scrypt) — not an oracle.
    expect(fixedDummy).toBeGreaterThan(known * 0.5);
    // MUST-FAIL PROOF: the old dummy returns near-instantly (no KDF) — dramatically faster than a real
    // verify. This is exactly the oracle; the test would have caught it, and catches any regression to it.
    expect(oldDummy).toBeLessThan(known * 0.5);
  });
});
