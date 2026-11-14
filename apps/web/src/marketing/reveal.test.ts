import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// [SITE2-MOTION] The landing page must NEVER leave content permanently hidden.
// [P70 · owner] The rebuilt page has no reveal script (reveal.ts is retired) and no sticky mobile CTA (removed on
// purpose). Scroll reveals are CSS only, inside @supports (animation-timeline: view()): a browser without it shows
// everything as normal, and nothing ships hidden waiting for JavaScript.
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

describe('[P70] no content waits on JavaScript to be shown', () => {
  it('no JS reveal hooks and no hidden blocks in the shipped HTML', () => {
    expect(d.querySelectorAll('[data-reveal], [data-stagger-item], [data-deal-item]')).toHaveLength(0);
    expect(d.querySelectorAll('main [hidden]')).toHaveLength(0);
    expect(existsSync(resolve(process.cwd(), 'apps/web/src/marketing/reveal.ts'))).toBe(false);
  });

  it('the only scroll reveal is the CSS one, and only where the browser supports view timelines', () => {
    const outside = style.replace(/@supports \(animation-timeline: view\(\)\)\{[\s\S]*?\n\}/, '');
    expect(outside).not.toMatch(/animation-timeline/);
    expect(outside).not.toMatch(/\.tv-rv\{/);
  });

  it('NEGATIVE: there is no sticky mobile CTA', () => {
    expect(d.querySelector('[data-mobile-cta], .mobile-cta')).toBeNull();
  });
});
