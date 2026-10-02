import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUDIO_RETENTION_DAYS } from '../media/audio-retention-service.js';

/**
 * [LEGAL-CLAIMS] The published Privacy page (2026-10-02) makes two promises a future change could
 * silently break. These guards tie each to the code/claim that makes it true, so a drift fails the build
 * rather than publishing a false statement. Reads the published HTML from the repo root (process.cwd()),
 * like versions.test.ts (node env — no DOMParser; a substring/regex is unambiguous here).
 */
const PRIVACY = readFileSync(resolve(process.cwd(), 'apps/web/privacy/index.html'), 'utf8');

describe('[LEGAL-CLAIMS] the published privacy page cannot drift from the product', () => {
  // Guard 1: the page states a recording is deleted ~AUDIO_RETENTION_DAYS after transcription. Tie the
  // NUMBER (in its recording context) to the constant, so changing AUDIO_RETENTION_DAYS without updating
  // the page fails here — otherwise we would eventually publish a retention period the product does not keep.
  it('states the audio-retention period, tied to AUDIO_RETENTION_DAYS', () => {
    expect(AUDIO_RETENTION_DAYS).toBe(30); // the published prose ("about thirty days") also tracks this
    expect(PRIVACY).toMatch(new RegExp(String.raw`\b${AUDIO_RETENTION_DAYS} days after transcription`));
  });

  // Guard 2: images are never sent to any AI supplier. This is the claim we CORRECTED from a false one
  // (the old page implied redaction covered everything "seen by our AI supplier"); it is the easiest to
  // lose in a future rewrite, so assert it is present.
  it('states that photographs are never sent to any AI supplier', () => {
    expect(PRIVACY).toContain('never sent to any AI supplier');
  });
});
