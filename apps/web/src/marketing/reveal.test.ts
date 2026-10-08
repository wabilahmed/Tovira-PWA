import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initMarketingMotion } from './reveal.js';

// [SITE2-MOTION] The reveal system must NEVER leave content permanently hidden.
// jsdom has no IntersectionObserver, which is exactly the "observer absent" path:
// everything must be revealed immediately (the no-JS/old-browser guarantee).
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const fresh = (): Document => new DOMParser().parseFromString(html, 'text/html');

describe('initMarketingMotion (observer-absent fallback)', () => {
  it('reveals every [data-reveal] block when IntersectionObserver is unavailable', () => {
    const d = fresh();
    expect(d.querySelectorAll('[data-reveal]').length).toBeGreaterThan(0);
    initMarketingMotion(d);
    for (const el of d.querySelectorAll('[data-reveal]')) {
      expect(el.hasAttribute('data-revealed')).toBe(true);
    }
  });

  it('un-hides the mobile CTA (it is only hidden until JS decides to show it)', () => {
    const d = fresh();
    const bar = d.querySelector<HTMLElement>('[data-mobile-cta]')!;
    expect(bar.hidden).toBe(true); // ships hidden in the HTML
    initMarketingMotion(d);
    expect(bar.hidden).toBe(false);
  });

  it('never throws on a document with none of the funnel hooks', () => {
    const empty = new DOMParser().parseFromString('<main></main>', 'text/html');
    expect(() => initMarketingMotion(empty)).not.toThrow();
  });
});
