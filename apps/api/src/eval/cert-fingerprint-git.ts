import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CERT_SURFACE } from './extraction-fingerprint.js';

/** [P55-1] A commit's CERT_SURFACE fingerprint read from git (the same bytes and hashing as fingerprintFiles), or
 *  undefined when the commit or a file cannot be read. Used by the decide job to match commits to certifications. */
export function certFingerprintAt(sha: string, cwd: string = process.cwd()): string | undefined {
  const h = createHash('sha256');
  try {
    for (const f of [...CERT_SURFACE].sort()) {
      const content = execFileSync('git', ['show', `${sha}:apps/api/src/${f}`], { cwd, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
      h.update(f).update('\0').update(content).update('\0');
    }
  } catch {
    return undefined;
  }
  return h.digest('hex');
}
