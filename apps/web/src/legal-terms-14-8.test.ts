// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** [P38 · owner, 21 Oct] The lawyer-approved sentence, word for word, as clause 14.8 — the last clause of
 *  "14. General", right after 14.7 (Notices). Not one character may change. */
const SENTENCE = 'Nothing in these Terms reduces any mandatory rights you have under applicable consumer protection law.';
const html = readFileSync(resolve(process.cwd(), 'apps/web/terms/index.html'), 'utf8');
const text = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('[P38] Terms 14.8 — the consumer-rights sentence, verbatim', () => {
  it('is in the rendered Terms exactly, as clause 14.8', () => {
    expect(html).toContain(`<p><strong>14.8</strong> ${SENTENCE}</p>`);
    expect(text(html)).toContain(`14.8 ${SENTENCE}`);
  });

  it('comes right after 14.7 (Notices) and is the last clause before section 15', () => {
    const notices = html.indexOf('<strong>14.7 Notices.</strong>');
    const clause = html.indexOf('<strong>14.8</strong>');
    const fifteen = html.indexOf('<h2>15. Contact</h2>');
    expect(notices).toBeGreaterThan(-1);
    expect(notices < clause && clause < fifteen).toBe(true);
    expect(html).not.toMatch(/<strong>14\.(9|\d{2})/); // nothing after it in section 14
  });

  it('stays in Terms version 2026-10-21', () => {
    expect(html).toContain('Last updated: 21 October 2026 · Version 2026-10-21');
  });
});
