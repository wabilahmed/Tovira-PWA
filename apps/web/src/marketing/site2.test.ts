import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [SITE2] Regression + content/a11y guard for the STARFIELD landing (three-act redesign). Runs against
// the REAL shipped HTML, so a dropped section or a broken CTA fails here. The page's styling is INLINE in
// index.html (site.css is the legal pages' stylesheet, not the landing's), so CSS assertions read EN.
//
// These assertions were ported from the previous funnel page and re-pointed at the new selectors. Each
// `it` names the CONTRACT it still enforces — the thing the business/accessibility needs true, not the old
// wording. What was dropped from the old suite: the exact hero/section heading strings and their order,
// and the selectors #how / .plans / .faq / .sec--band / .device / [data-reveal] (old design only).
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const doc = (p: string): Document => new DOMParser().parseFromString(read(p), 'text/html');
const EN = 'apps/web/index.html';

describe('[SITE2] the three-act structure and its landmarks', () => {
  const d = doc(EN);

  it('has exactly one h1 (the hero)', () => {
    expect(d.querySelectorAll('h1')).toHaveLength(1);
  });

  // CONTRACT (was "funnel present, in order"): the three acts ship, in order, each a labelled landmark
  // section. The labels are the semantic spine; the exact headings are free to change.
  it('ships the three acts in order, each a <section> with its aria-label', () => {
    const labels = [...d.querySelectorAll('main section')].map((s) => s.getAttribute('aria-label'));
    expect(labels).toEqual(['The problem', 'What Tovira returns', 'What your week looks like']);
  });
});

describe('[SITE2] the contracts the redesign must not drop', () => {
  const d = doc(EN);

  // CONTRACT: both plans are present and priced — monthly AED 299 and annual AED 2,990 — with the
  // two-months-free framing, and NO urgency/discount dark-patterns anywhere on the page.
  it('prices both plans with the two-months-free framing, no urgency patterns', () => {
    const pricing = d.querySelector('.pricing');
    expect(pricing, 'a pricing block exists').not.toBeNull();
    const text = pricing!.textContent ?? '';
    expect(text).toContain('AED 299');
    expect(text).toContain('AED 2,990');
    expect(text).toMatch(/two months free/i);
    expect(read(EN)).not.toMatch(/most popular|only today|countdown|was AED|<s>|strike/i);
  });

  // CONTRACT: a six-question FAQ exists, the first open by default, including the "who is it not for"
  // question with its approved answer (in-person/relationship sellers; the recorded-video exclusion kept;
  // NOT the retired "good tools already exist" framing).
  it('has a six-question FAQ, first open, including a correct "who is it not for"', () => {
    const items = [...d.querySelectorAll<HTMLDetailsElement>('.faq details')];
    expect(items).toHaveLength(6);
    expect(items[0]!.hasAttribute('open')).toBe(true);
    const notFor = items.find((el) => /who is it not for/i.test(el.querySelector('summary')?.textContent ?? ''));
    expect(notFor, 'the "Who is it not for?" question is present').toBeTruthy();
    const answer = notFor!.querySelector('p')?.textContent ?? '';
    expect(answer).not.toMatch(/good tools already exist/i);
    expect(answer).toMatch(/in person|relationship/i);
    expect(answer).toMatch(/recorded video/i);
  });

  // CONTRACT: the four sanctioned security claims appear VERBATIM, and the page makes no claim beyond
  // them (no bank-grade / SOC2 / ISO / certified overreach). Counsel-approved wording — ported, not rewritten.
  it('carries the four sanctioned security claims verbatim and no overclaim', () => {
    const sec = d.querySelector('.security');
    expect(sec, 'a security region exists').not.toBeNull();
    const t = sec!.textContent ?? '';
    expect(t).toMatch(/encrypted in transit and at rest/i);
    expect(t).toContain('One rep can never read another');
    expect(t).toContain('Tovira never connects to your WhatsApp account');
    expect(t).toContain('Follow-up drafts open in WhatsApp with the text ready');
    expect(t).toMatch(/including from our training records/i);
    expect(t).not.toMatch(/bank-grade|military-grade|SOC ?2|ISO ?27001|compliance|certified/i);
  });

  // CONTRACT: every CTA is a plain link to the beta request form (works with no JS), and a mobile sticky
  // CTA exists. (ref/utm pass-through is proven in ref.test.ts.)
  it('every [data-cta] points at /request-access, and a mobile sticky CTA exists', () => {
    const ctas = [...d.querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    expect(ctas.length).toBeGreaterThanOrEqual(3); // nav, close, mobile bar
    for (const a of ctas) expect(a.getAttribute('href')).toBe('/request-access');
    expect(d.querySelector('[data-mobile-cta]')).not.toBeNull();
  });

  // CONTRACT: the footer carries the legal links. (Also guarded in legal.test.ts.)
  it('the footer links /privacy and /terms', () => {
    const hrefs = [...d.querySelectorAll('footer a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/privacy');
    expect(hrefs).toContain('/terms');
  });

  // CONTRACT: decorative visuals never leak to assistive tech. The orbs + fragment pile are purely
  // decorative and must be aria-hidden (there is no role=img phone frame on this page).
  it('decorative layers are aria-hidden', () => {
    expect(d.querySelector('.pile')?.getAttribute('aria-hidden')).toBe('true');
    expect(d.querySelector('.ambient')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('[SITE2] motion is safe (visible focus + reduced-motion), styles inline', () => {
  const css = read(EN); // the page's styles live inline in index.html

  // CONTRACT (was "brass focus ring"): a VISIBLE focus ring exists. The ring colour is the page's own
  // --focus now, not the brand --brass — so assert a visible 2px ring, not a specific variable.
  it('defines a visible :focus-visible ring', () => {
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline:\s*2px solid var\(--focus\)/);
  });

  // CONTRACT: prefers-reduced-motion is honoured — all animation is collapsed for users who ask for it.
  it('honours prefers-reduced-motion (animation disabled)', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });
});
