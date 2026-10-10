import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * [SW-UPDATE] Guard the cache-header fix at its source: the deploy workflow. The stale-build bug was a
 * single blanket `s3 sync --delete` with NO Cache-Control, so CloudFront/the browser cached sw.js and
 * index.html and the service worker never saw a new release. The fix is a two-pass upload — hashed
 * assets immutable, everything else no-cache. If someone reverts to one blanket sync (or drops the
 * no-cache pass), this fails. Reads the real workflow so it can't drift from what actually deploys.
 */
const deployYml = readFileSync(fileURLToPath(new URL('../../../../.github/workflows/deploy.yml', import.meta.url)), 'utf8');

describe('[SW-UPDATE] deploy sets release-safe cache headers', () => {
  it('uploads hashed assets as long-lived + immutable', () => {
    expect(deployYml).toMatch(/dist\/assets[^\n]*s3:[^\n]*\n[^\n]*max-age=31536000, immutable/);
  });

  it('uploads everything else (HTML, sw.js, manifest) no-cache so a release reaches returning users', () => {
    expect(deployYml).toMatch(/--cache-control 'no-cache'/);
    // the no-cache pass must exclude the immutable assets so it never re-headers them
    expect(deployYml).toMatch(/--exclude 'assets\/\*'/);
  });

  it('does NOT keep a blanket sync with no Cache-Control (the original bug)', () => {
    // every `s3 sync ... dist` of the whole build must carry a --cache-control flag
    const blanketNoHeader = /s3 sync apps\/web\/dist "s3:\/\/\$\{\{ vars\.FRONTEND_BUCKET \}\}"(?![^\n]*--cache-control)[^\n]*--delete\s*$/m;
    expect(deployYml).not.toMatch(blanketNoHeader);
  });
});
