// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * [P70-4 · owner] Two small fixes after the first live Lighthouse run:
 *  - P30 decided: canonical and hreflang are absolute on tovira.io, on the landing page and on Privacy and Terms.
 *  - The marquee's dim words were #4A423B (1.9:1); now #7D736A, which clears 3:1 for large text on every background
 *    the marquee sits on (the page #120F0D and #171412, and the orb glow #282013 Lighthouse measured).
 * [P89 · owner, Prompt 86] The Marker landing has no marquee (and the P70 design file is deleted), so the marquee pins
 * become: it is gone, and none of its old colours is on the page. Contrast on the Marker page is pinned in
 * brand-guard.test.ts. The canonical pins stay (and the seven game pages are pinned in game-pages.test.ts).
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const doc = (p: string) => new DOMParser().parseFromString(read(p), 'text/html');
const PAGES = [['apps/web/index.html', 'https://tovira.io/'], ['apps/web/privacy/index.html', 'https://tovira.io/privacy'], ['apps/web/terms/index.html', 'https://tovira.io/terms']] as const;

describe('[P70-4] P30: absolute canonical and hreflang', () => {
  it.each(PAGES)('%s names %s', (p, url) => {
    const d = doc(p);
    expect(d.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(d.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(url);
    const alt = Object.fromEntries([...d.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => [l.getAttribute('hreflang'), l.getAttribute('href')]));
    expect(alt).toEqual({ en: url, 'x-default': url });
  });
});

describe('[P70-4→P89] the marquee is gone with the P70 page', () => {
  it('no marquee and none of its colours on the page', () => {
    const page = read('apps/web/index.html');
    expect(page).not.toMatch(/tv-marq|padding: 0 28px/);
    expect(page).not.toMatch(/#7D736A|#4A423B/i);
  });
});
