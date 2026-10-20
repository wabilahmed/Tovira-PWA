// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** [P37] With prefers-reduced-motion the tour has no animated transitions: every tour transition sits inside
 *  the `prefers-reduced-motion: no-preference` block. */
describe('[P37] the tour respects reduced motion', () => {
  it('no tour rule animates outside the no-preference block', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles/theme.css'), 'utf8');
    const motionBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g)].map((m) => m[0]);
    let outside = css;
    for (const b of motionBlocks) outside = outside.replace(b, '');
    const tourRules = [...outside.matchAll(/\.tov-tour[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(tourRules.length).toBeGreaterThan(0);
    for (const body of tourRules) expect(body).not.toMatch(/transition|animation/);
    expect(motionBlocks.some((b) => b.includes('.tov-tour'))).toBe(true);
  });
});
