import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [SITE2] Regression + a11y for the story-funnel landing. Runs against the REAL
// shipped HTML/CSS, so a dropped section or a broken CTA fails here.
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const doc = (p: string): Document => new DOMParser().parseFromString(read(p), 'text/html');
const EN = 'apps/web/index.html';
const CSS = 'apps/web/src/marketing/site.css';

describe('[SITE2] the funnel is present, in order', () => {
  const d = doc(EN);
  const headings = [...d.querySelectorAll('h1, h2')].map((h) => (h.textContent ?? '').trim());

  it('has exactly one h1 (the hero) and it leads', () => {
    expect(d.querySelectorAll('h1')).toHaveLength(1);
    expect(headings[0]).toMatch(/Forty clients/);
  });

  it('runs hook → cost → turn → how → proof → use cases → security → plans → FAQ → close', () => {
    const order = [
      /Forty clients/,
      /Forgetting is silent/,
      /What if the record kept itself/,
      /Three steps/,
      /never tells you something it cannot show/,
      /Built for people whose deals are relationships/,
      /It is your book\. It stays yours/,
      /One price\. Everything included/,
      /Questions/,
      /Your client book is an asset/,
    ];
    let i = 0;
    for (const re of order) {
      const at = headings.findIndex((h, k) => k >= i && re.test(h));
      expect(at, `heading not found in order: ${re}`).toBeGreaterThanOrEqual(i);
      i = at + 1;
    }
  });

  it('every CTA is a plain link to /app (works with no JS) and there is a sticky mobile bar', () => {
    const ctas = [...d.querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    expect(ctas.length).toBeGreaterThanOrEqual(4); // nav, hero, plans, close, mobile bar
    for (const a of ctas) expect(a.getAttribute('href')).toBe('/app');
    expect(d.querySelector('[data-mobile-cta]')).not.toBeNull();
  });

  it('plans: two prices in mono, a quiet "two months free" marker, no urgency/discount patterns', () => {
    const plans = d.querySelector('.plans')!;
    expect(plans.querySelectorAll('.plan')).toHaveLength(2);
    expect(plans.textContent).toContain('AED 299');
    expect(plans.textContent).toContain('AED 2,990');
    expect(plans.textContent).toMatch(/two months free/);
    expect(read(EN)).not.toMatch(/most popular|only today|countdown|was AED|<s>|strike/i);
  });

  it('FAQ has all six questions and opens the first by default', () => {
    const items = [...d.querySelectorAll('.faq details')];
    expect(items).toHaveLength(6);
    expect(items[0]!.hasAttribute('open')).toBe(true);
  });

  it('security makes no claim beyond the four sanctioned ones', () => {
    const sec = d.querySelector('.sec--band')!.textContent ?? '';
    expect(sec).toMatch(/encrypted in transit and at rest/i);
    expect(sec).not.toMatch(/bank-grade|military-grade|SOC ?2|ISO ?27001|compliance|certified/i);
  });

  it('decorative visuals are labelled (role=img + aria-label) or hidden (aria-hidden)', () => {
    for (const el of d.querySelectorAll('.device')) {
      const labelled = el.getAttribute('role') === 'img' && (el.getAttribute('aria-label') ?? '').trim().length > 0;
      const hidden = el.closest('[aria-hidden="true"]') !== null || el.getAttribute('aria-hidden') === 'true';
      expect(labelled || hidden, 'a phone frame is neither labelled nor hidden').toBe(true);
    }
  });
});

describe('[SITE2] motion is a progressive enhancement (no-JS + reduced-motion safe)', () => {
  const css = read(CSS);

  it('reveal hidden states are gated on .js — with no JS, content is visible', () => {
    // Every rule that sets opacity:0 for a reveal target is scoped under `.js`.
    for (const m of css.matchAll(/([^{}]*\[data-(?:reveal|stagger-item|deal-item)\][^{}]*)\{[^}]*opacity:\s*0/g)) {
      expect(m[1]).toMatch(/\.js\b/);
    }
  });

  it('reduced-motion collapses every reveal to its final, untransformed state', () => {
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(block).toMatch(/\[data-reveal\][\s\S]*opacity:\s*1\s*!important/);
    expect(block).toMatch(/transform:\s*none\s*!important/);
  });

  it('the FAQ is keyboard-navigable native disclosure (details/summary) and focus is visible', () => {
    expect(doc(EN).querySelectorAll('.faq details > summary').length).toBe(6);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline:\s*2px solid var\(--brass\)/);
  });
});
