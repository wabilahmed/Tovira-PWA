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
  // CONTRACT (was "reveal every [data-reveal]"): the page never leaves content hidden without JS. The
  // Starfield redesign dropped the reveal-on-scroll system entirely — everything is statically visible —
  // so the guard is now the inverse: NO reveal-hidden content ships, and init is a safe no-op for it.
  it('ships no reveal-hidden content (static page is fully visible without JS)', () => {
    const d = fresh();
    expect(d.querySelectorAll('[data-reveal]').length).toBe(0);
    expect(() => initMarketingMotion(d)).not.toThrow();
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
