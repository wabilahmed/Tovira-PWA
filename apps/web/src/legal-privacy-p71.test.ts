// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRIVACY_VERSION, TERMS_VERSION } from '../../api/src/services/legal/versions.js';

/**
 * [P71-T · owner] The lawyer-approved line, word for word, straight after "We keep anonymous statistics about how the
 * product is used.": "We count anonymous game interactions to improve the page." Only that line changes in the
 * wording; the version moves to 2026-11-16 by the legal-archive process (the outgoing 2026-10-27 text was already
 * frozen; the new one is frozen too). Terms are untouched. Bumping the version asks no one to re-accept: it is only
 * recorded when someone accepts.
 */
const LINE = 'We count anonymous game interactions to improve the page.';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const bodyText = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent!.replace(/\s+/g, ' ').trim();

describe('[P71-T] the Privacy page names the game counts', () => {
  const page = read('apps/web/privacy/index.html');
  it('has the line, word for word, straight after the anonymous-statistics sentence', () => {
    expect(bodyText(page)).toContain(`We keep anonymous statistics about how the product is used. ${LINE} Your conversations are kept`);
    expect(page.split(LINE)).toHaveLength(2); // once
  });
  it('is version 2026-11-16, last updated 16 November 2026; the Terms version is unchanged', () => {
    expect(PRIVACY_VERSION).toBe('2026-11-16');
    expect(page).toContain('data-doc-version="2026-11-16">Last updated: 16 November 2026 · Version 2026-11-16</p>');
    expect(TERMS_VERSION).toBe('2026-10-21');
  });
  it('only that line (and the date and version) changed from the 2026-10-27 wording, which stays archived', () => {
    const before = read('legal-archive/2026-10-27/privacy.html');
    expect(before).not.toContain(LINE);
    const strip = (t: string) => t.replace(` ${LINE}`, '').replace(/Last updated: [^·]+· Version [\d-]+/, 'STAMP');
    expect(strip(bodyText(page))).toBe(strip(bodyText(before)));
  });
  it('the new wording is frozen in legal-archive/2026-11-16', () => {
    const frozen = read('legal-archive/2026-11-16/privacy.html');
    expect(bodyText(frozen)).toBe(bodyText(page));
  });
});
