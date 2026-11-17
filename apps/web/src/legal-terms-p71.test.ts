// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRIVACY_VERSION, TERMS_VERSION } from '../../api/src/services/legal/versions.js';

/**
 * [P71-L · owner, lawyer-approved wording, word for word] A new section "AI-generated information", placed straight
 * after "8. Accuracy, output, and no reliance" (the disclaimers) and before the liability section. It becomes
 * section 9, so the old sections 9 to 15 become 10 to 16, with their clause numbers and the cross-references inside
 * the Terms that point at them. Nothing else in the wording changed from the 2026-10-21 version, which stays archived.
 * The version moves to 2026-11-17 by the legal-archive process. Bumping it asks no one to re-accept: the version is
 * only recorded when someone accepts.
 */
const HEADING = '9. AI-generated information';
const SECTION = [
  'Tovira uses artificial intelligence to analyse the conversations, voice notes and notes you give it. AI can make mistakes. Tovira does not guarantee that:',
  '(a) the details, dates, promises or other information it extracts or displays are accurate or complete; or',
  '(b) it will identify every detail, date or promise in your conversations.',
  'Treat everything Tovira displays as a helpful prompt, not as a statement of fact. Before you rely on any information, including before contacting a client, making a commitment or making a business decision, check it against the original message, which Tovira links where available. You remain responsible for your own decisions and your dealings with your clients.',
  'To the extent permitted by applicable law, we are not liable for any loss arising from reliance on information displayed by Tovira that is inaccurate or incomplete.',
];
/** The cross-references inside the Terms that the new section shifts (old → new). Everything else stays. */
const REFS: Array<[string, string]> = [
  ['Subject to 10.1, we are not liable', 'Subject to 11.1, we are not liable'],
  ['Without limiting 10.2,', 'Without limiting 11.2,'],
  ['Subject to 10.1, our total aggregate liability', 'Subject to 11.1, our total aggregate liability'],
  ['under 12.2 or 12.3,', 'under 13.2 or 13.3,'],
  ['Clauses 4, 8, 9, 10, 13, and 14 survive termination.', 'Clauses 4, 8, 10, 11, 14, and 15 survive termination.'],
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Each heading, paragraph and list item of the document, in order, as plain text. */
const blocks = (html: string): string[] =>
  [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('main h1, main h2, main p, main li')].map((e) => clean(e.textContent!));
const STAMP = /^Last updated: [^·]+· Version [\d-]+$/;

describe('[P71-L] Terms: the AI-generated information section', () => {
  const page = read('apps/web/terms/index.html');
  const live = blocks(page);

  it('has the section, word for word, as section 9, straight after 8.6 and before the data protection section', () => {
    const h = live.indexOf(HEADING);
    expect(h).toBeGreaterThan(-1);
    expect(live[h - 1]).toMatch(/^8\.6 No warranty\./);
    expect(live.slice(h + 1, h + 1 + SECTION.length)).toEqual(SECTION);
    expect(live[h + 1 + SECTION.length]).toBe('10. Data protection allocation');
    expect(page.split('AI can make mistakes.')).toHaveLength(2); // once
  });

  it('sections run 1 to 16 in order', () => {
    const heads = [...new DOMParser().parseFromString(page, 'text/html').querySelectorAll('main h2')].map((e) => clean(e.textContent!));
    expect(heads).toEqual([
      '1. The agreement', '2. What Tovira is, and what it is not', '3. Your account', '4. Your content and your responsibility for it',
      '5. Acceptable use', '6. Price and payment', '7. Limits and availability', '8. Accuracy, output, and no reliance', HEADING,
      '10. Data protection allocation', '11. Liability', '12. Force majeure', '13. Suspension and termination',
      '14. Governing law and disputes', '15. General', '16. Contact',
    ]);
  });

  it('is version 2026-11-17, last updated 17 November 2026; Privacy is unchanged', () => {
    expect(TERMS_VERSION).toBe('2026-11-17');
    expect(page).toContain('data-doc-version="2026-11-17">Last updated: 17 November 2026 · Version 2026-11-17</p>');
    expect(PRIVACY_VERSION).toBe('2026-11-16');
  });

  it('everything else is the archived 2026-10-21 wording, word for word, renumbered only', () => {
    const before = blocks(read('legal-archive/2026-10-21/terms.html'));
    const at = before.findIndex((b) => /^8\.6 No warranty\./.test(b)) + 1;
    const expected = [...before.slice(0, at), HEADING, ...SECTION, ...before.slice(at).map((b) => {
      let out = b.replace(/^(9|1[0-5])(\.\d*)/, (_m, n: string, rest: string) => `${Number(n) + 1}${rest}`); // its own number
      for (const [from, to] of REFS) out = out.replace(from, to);
      return out;
    })].map((b) => (STAMP.test(b) ? 'STAMP' : b));
    expect(live.map((b) => (STAMP.test(b) ? 'STAMP' : b))).toEqual(expected);
  });

  it('NEGATIVE: references to the Privacy Policy and to unshifted clauses are not renumbered', () => {
    const text = live.join(' ');
    expect(text).toContain('as described in section 10 of the Privacy Policy');
    expect(text).toContain('clause 4.7 applies');
    expect(text).toContain('notified in advance under clause 6.6');
    for (const [from] of REFS) expect(text).not.toContain(from);
  });

  it('the new wording is frozen in legal-archive/2026-11-17', () => {
    expect(blocks(read('legal-archive/2026-11-17/terms.html'))).toEqual(live);
  });
});
