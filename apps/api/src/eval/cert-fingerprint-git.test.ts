import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { certFingerprintAt } from './cert-fingerprint-git.js';
import { CERT_SURFACE, fingerprintFiles } from './extraction-fingerprint.js';

// [P55-1] The decide job computes a commit's CERT_SURFACE fingerprint from git, byte-for-byte the way the gate does from
// the working tree, so a later commit can be matched to a failed certification.
function repo(contents: (f: string) => string): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fp-'));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  for (const f of CERT_SURFACE) { const p = join(dir, 'apps/api/src', f); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, contents(f)); }
  git('add', '.'); git('commit', '-qm', 'x');
  return { dir, sha: git('rev-parse', 'HEAD') };
}

describe('[P55-1] certFingerprintAt', () => {
  it('equals the gate\'s fingerprint of the same files', () => {
    const { dir, sha } = repo((f) => `content of ${f}`);
    expect(certFingerprintAt(sha, dir)).toBe(fingerprintFiles(join(dir, 'apps/api/src'), CERT_SURFACE));
  });
  it('NEGATIVE: different content gives a different fingerprint; an unknown commit gives none', () => {
    const a = repo((f) => `a ${f}`);
    const b = repo((f) => `b ${f}`);
    expect(certFingerprintAt(a.sha, a.dir)).not.toBe(certFingerprintAt(b.sha, b.dir));
    expect(certFingerprintAt('0'.repeat(40), a.dir)).toBeUndefined();
  });
});
