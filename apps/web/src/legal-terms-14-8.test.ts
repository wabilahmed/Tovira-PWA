// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** [P38 · owner, 21 Oct] The lawyer-approved sentence, word for word, as clause 14.8 — the last clause of
 *  "14. General", right after 14.7 (Notices). Not one character may change. */
const SENTENCE = 'Nothing in these Terms reduces any mandatory rights you have under applicable consumer protection law.';
const html = readFileSync(resolve(process.cwd(), 'apps/web/terms/index.html'), 'utf8');
// [P71-L · owner] the AI-generated information section went in as 9, so "14. General" is now 15 and this clause 15.8;
// the 2026-10-21 version (clause 14.8) stays frozen in the archive.
const archived = readFileSync(resolve(process.cwd(), 'legal-archive/2026-10-21/terms.html'), 'utf8');
const text = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('[P38] Terms 14.8 — the consumer-rights sentence, verbatim', () => {
  it('is in the rendered Terms exactly, as clause 15.8 (14.8 in the 2026-10-21 version)', () => {
    expect(html).toContain(`<p><strong>15.8</strong> ${SENTENCE}</p>`);
    expect(text(html)).toContain(`15.8 ${SENTENCE}`);
    expect(archived).toContain(`<p><strong>14.8</strong> ${SENTENCE}</p>`);
  });

  it('comes right after 15.7 (Notices) and is the last clause before section 16', () => {
    const notices = html.indexOf('<strong>15.7 Notices.</strong>');
    const clause = html.indexOf('<strong>15.8</strong>');
    const fifteen = html.indexOf('<h2>16. Contact</h2>');
    expect(notices).toBeGreaterThan(-1);
    expect(notices < clause && clause < fifteen).toBe(true);
    expect(html).not.toMatch(/<strong>15\.(9|\d{2})/); // nothing after it in section 15
  });

  it('was added in Terms version 2026-10-21 (frozen in the archive)', () => {
    expect(archived).toContain('Last updated: 21 October 2026 · Version 2026-10-21');
  });
});
