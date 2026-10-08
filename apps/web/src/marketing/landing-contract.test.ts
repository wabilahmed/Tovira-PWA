import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [LANDING-REVERT] The facts the landing MUST state, independent of its design. These assertions fail on
// the Starfield page (no contact email / VAT / trial, and it keeps the retired "training records" claim)
// and pass on the reverted page once the facts are carried forward. Reads the REAL shipped HTML.
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const EN = 'apps/web/index.html';
const html = read(EN);
const d = new DOMParser().parseFromString(html, 'text/html');

describe('[LANDING-REVERT] carried-forward facts', () => {
  it('contact email is hello@tovira.io (and no other contact address)', () => {
    expect(html).toContain('hello@tovira.io');
    expect(d.querySelector('a[href="mailto:hello@tovira.io"]')).not.toBeNull();
    // no stale personal / wrong contact address
    expect(html).not.toMatch(/@prospera-technologies\.com|@tovira\.com/i);
  });

  it('prices are AED 299 / AED 2,990, VAT-inclusive, with a 14-day trial', () => {
    expect(html).toContain('AED 299');
    expect(html).toContain('AED 2,990');
    expect(html).toMatch(/include[s]? VAT|VAT[- ]inclusive/i);
    expect(html).toMatch(/14[- ]day/i);
  });

  it('states no retired claim: no "training records", and voice is in-app only', () => {
    expect(html).not.toMatch(/training records/i);
    // any mention of training is the negative promise, never a retention claim
    if (/\btrain(ing|s|ed)?\b/i.test(html)) expect(html).toMatch(/do not use .*to train|not .*train/i);
    // in-app capture only — no claim of importing an external audio file
    expect(html).not.toMatch(/upload (an? )?(audio|voice) (file|note|recording)/i);
  });

  it('every CTA keeps its data-cta attribute and points at the request form', () => {
    const ctas = [...d.querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    expect(ctas.length).toBeGreaterThanOrEqual(3);
    for (const a of ctas) expect(a.getAttribute('href')).toBe('/request-access');
  });

  it('legal links point at the current terms/privacy pages (in the footer)', () => {
    const hrefs = [...d.querySelectorAll('footer a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/privacy');
    expect(hrefs).toContain('/terms');
  });

  it('semantic landmarks: one banner <header> (direct child of body), one <main>, one <footer>', () => {
    expect(d.querySelectorAll('body > header')).toHaveLength(1);
    expect(d.querySelectorAll('main')).toHaveLength(1);
    expect(d.querySelectorAll('footer')).toHaveLength(1);
    expect(d.querySelector('section header, article header, aside header, nav header, main header')).toBeNull();
  });

  it('the annual plan, FAQ, security band and mobile CTA are all present', () => {
    expect(html).toMatch(/\/ year/);                       // annual plan
    expect(d.querySelectorAll('details.faq__item').length).toBeGreaterThanOrEqual(3); // FAQ
    expect(d.querySelector('.sec--band')).not.toBeNull();  // security band
    expect(d.querySelector('[data-mobile-cta]')).not.toBeNull(); // mobile sticky CTA
  });
});
