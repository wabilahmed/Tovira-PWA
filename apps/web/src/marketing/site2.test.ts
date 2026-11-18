import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [SITE2] Regression + a11y for the landing funnel. Runs against the REAL shipped HTML, so a dropped section or a
// broken CTA fails here.
// [P70 · owner] The landing page was rebuilt from the owner's approved design: new sections and order, four FAQ
// questions (none open by default), "It shows its work" in place of the security band, no sticky mobile bar (removed on
// purpose), and its styles inline in index.html (site.css now serves only Privacy and Terms). The contracts are kept.
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const EN = 'apps/web/index.html';
const html = read(EN);
const d = new DOMParser().parseFromString(html, 'text/html');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

describe('[SITE2] the funnel is present, in order', () => {
  const headings = [...d.querySelectorAll('h1, h2')].map((h) => (h.textContent ?? '').trim());

  it('has exactly one h1 (the hero) and it leads', () => {
    expect(d.querySelectorAll('h1')).toHaveLength(1);
    expect(headings[0]).toMatch(/The detail that wins the deal is already in your chats/);
  });

  it('runs hook → game → problem → industries → how → trust → plans → FAQ → close', () => {
    const order = [
      /The detail that wins the deal/,
      /Would you have caught it/,
      /Your clients tell you how to win them/,
      /See what Tovira would catch/,
      /Send it a chat/,
      /It shows its work, then puts it to work/, // [P76 · owner] the trust section's new heading
      /One plan\. Pays for itself/,
      /Questions/,
      /Your next client has already told you/,
    ];
    let i = 0;
    for (const re of order) {
      const at = headings.findIndex((h, k) => k >= i && re.test(h));
      expect(at, `heading not found in order: ${re}`).toBeGreaterThanOrEqual(i);
      i = at + 1;
    }
  });

  it('the "how" section names the morning list and what each client cares about', () => {
    const how = d.querySelector('#how')?.textContent ?? '';
    expect(how).toMatch(/Each morning, who to call/);
    expect(how).toMatch(/what they care about/);
  });

  it('every CTA is a plain link to the beta request form (works with no JS), and there is no sticky bottom bar', () => {
    const ctas = [...d.querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    expect(ctas.length).toBeGreaterThanOrEqual(3); // header, hero, close (the game's end screen adds one)
    for (const a of ctas) expect(a.getAttribute('href')).toBe('/request-access');
    expect(d.querySelector('[data-mobile-cta]')).toBeNull();
  });

  it('plans: two prices, a quiet "two months free" marker, no urgency/discount patterns', () => {
    const plans = d.querySelector('#pricing')!;
    expect(plans.textContent).toContain('AED 299');
    expect(plans.textContent).toContain('AED 2,990');
    expect(plans.textContent).toMatch(/two months free/);
    expect(html).not.toMatch(/most popular|only today|countdown|was AED|<s>|strike/i);
  });

  // [P76 · owner] five questions now (the owner's, word for word in landing-p76.test.ts)
  it('FAQ has the five questions, as native disclosures', () => {
    expect(d.querySelectorAll('details > summary')).toHaveLength(5);
  });

  // [P76 · owner] "Who is it not for?" is removed with the owner's new FAQ; what stays checked is that no answer
  // falls back on a leftover-tool framing
  it('NEGATIVE: the "not for" FAQ is gone, and no answer uses a leftover-tool framing', () => {
    expect([...d.querySelectorAll('details > summary')].some((el) => /who is it not for/i.test(el.textContent ?? ''))).toBe(false);
    expect([...d.querySelectorAll('details')].map((el) => el.textContent ?? '').join(' ')).not.toMatch(/good tools already exist/i);
  });

  it('trust points make no claim beyond what is shipped', () => {
    const trust = d.querySelector('section[aria-labelledby="trust-h"]')!.textContent ?? '';
    // [P76 · owner] "Private by design" (with "Never used to train AI") is replaced by two features the product has:
    // the brief before a meeting and promises on your list before they're due
    expect(trust).toMatch(/A brief before every meeting/);
    expect(trust).toMatch(/Every promise, on time/);
    expect(html).not.toMatch(/bank-grade|military-grade|SOC ?2|ISO ?27001|compliance|certified/i);
  });

  it('decorative visuals are hidden (aria-hidden)', () => {
    for (const sel of ['.tv-orb', '.tv-star', '.tv-wall', '.tv-marq']) {
      for (const el of d.querySelectorAll(sel)) expect(el.closest('[aria-hidden="true"]'), sel).not.toBeNull();
    }
  });
});

describe('[SITE2] motion is a progressive enhancement (no-JS + reduced-motion safe)', () => {
  it('nothing is hidden waiting for JS: reveals are CSS-only, inside @supports', () => {
    expect(d.querySelector('[data-reveal]')).toBeNull();
    expect(style).toMatch(/@supports \(animation-timeline: view\(\)\)\{\s*\.tv-rv\{/);
  });

  it('reduced motion stops every animation', () => {
    expect(style).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^\n]*\.tv-rv[^\n]*animation:none !important/);
  });

  it('the FAQ is keyboard-navigable native disclosure (details/summary) and focus is visible', () => {
    expect(d.querySelectorAll('details > summary').length).toBe(5); // [P76 · owner] five questions
    expect(style).toMatch(/:focus-visible\{outline:2px solid #E8643A/);
  });
});
