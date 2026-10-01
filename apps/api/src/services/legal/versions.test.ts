import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TERMS_VERSION, PRIVACY_VERSION, CONFIRMATION_TEXT_VERSION } from './versions.js';

/**
 * [BETA-2c] THE reconcile guard. Without it the version constant and the published page drift apart
 * silently, and every acceptance record becomes a string pointing at nothing. It reads the published
 * HTML and fails if the page's machine-checkable version marker (data-doc-version) disagrees with the
 * constant. Run from the repo root (process.cwd()), like legal.test.ts. Parsed by regex: this suite
 * runs in the node environment (no DOMParser), and a single attribute is unambiguous.
 */
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const docVersion = (html: string): string | null => html.match(/data-doc-version="([^"]+)"/)?.[1] ?? null;

describe('[BETA-2c] legal versions reconcile with the published pages', () => {
  it('the published Terms page renders a version marker equal to TERMS_VERSION', () => {
    const html = read('apps/web/terms/index.html');
    expect(docVersion(html), 'apps/web/terms/index.html is missing data-doc-version').toBe(TERMS_VERSION);
    // The version must also be VISIBLE to a reader, not only a hidden attribute.
    expect(html).toContain(`Version ${TERMS_VERSION}`);
  });

  it('the published Privacy page renders a version marker equal to PRIVACY_VERSION', () => {
    const html = read('apps/web/privacy/index.html');
    expect(docVersion(html), 'apps/web/privacy/index.html is missing data-doc-version').toBe(PRIVACY_VERSION);
    expect(html).toContain(`Version ${PRIVACY_VERSION}`);
  });

  it('versions are date-based ISO identifiers (YYYY-MM-DD)', () => {
    for (const v of [TERMS_VERSION, PRIVACY_VERSION, CONFIRMATION_TEXT_VERSION]) {
      expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
