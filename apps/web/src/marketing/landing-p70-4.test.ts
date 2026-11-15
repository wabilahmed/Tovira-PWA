// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { marq, MARQ_A, MARQ_B } from './landing-data.js';

/**
 * [P70-4 · owner] Two small fixes after the first live Lighthouse run:
 *  - P30 decided: canonical and hreflang are absolute on tovira.io, on the landing page and on Privacy and Terms.
 *  - The marquee's dim words were #4A423B (1.9:1); now #7D736A, which clears 3:1 for large text on every background
 *    the marquee sits on (the page #120F0D and #171412, and the orb glow #282013 Lighthouse measured).
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

describe('[P70-4] marquee contrast', () => {
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  it('every marquee colour clears 3:1 (large text) on the page and the orb glow', () => {
    const colours = new Set([...marq(MARQ_A), ...marq(MARQ_B)].map((m) => m.color));
    expect(colours).toContain('#7D736A');
    expect(colours).not.toContain('#4A423B');
    for (const c of colours) for (const bg of ['#120F0D', '#171412', '#282013']) expect(ratio(c, bg), `${c} on ${bg}`).toBeGreaterThanOrEqual(3);
  });
  it('the page and the design file use the new colour', () => {
    expect(read('apps/web/index.html')).toMatch(/<span style="padding: 0 28px; color: #7D736A">/);
    expect(read('apps/web/index.html')).not.toMatch(/<span style="padding: 0 28px; color: #4A423B">/);
    expect(read('plan/tovira-landing-reference.dc.html')).toContain("(i % 3 === 2 ? '#F2EDE4' : '#7D736A')");
  });
});
