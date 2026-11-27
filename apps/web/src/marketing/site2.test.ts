import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [SITE2] Regression + a11y for the landing funnel. Runs against the REAL shipped HTML, so a dropped section or a
// broken CTA fails here.
// [P89 · owner, Prompt 86] The page is now the owner's Marker page: the scroll scene, then "Nothing gets missed",
// "Different on purpose", the game banner, three steps, what Tovira does, privacy, one price, two questions and the
// close. The SITE2 contracts are kept: one h1 that leads, every CTA a plain link to the request form, no sticky bottom
// bar, no urgency patterns, native disclosures, decorative visuals hidden, nothing hidden waiting for JavaScript, and
// reduced motion stops what moves (the stacked page, scene.ts).
const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = read('apps/web/index.html');
const d = new DOMParser().parseFromString(html, 'text/html');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

describe('[SITE2] the funnel is present, in order', () => {
  const headings = [...d.querySelectorAll('h1, h2')].map((h) => (h.textContent ?? '').trim());

  it('has exactly one h1 (the hero) and it leads', () => {
    expect(d.querySelectorAll('h1')).toHaveLength(1);
    expect(headings[0]).toBe('Walk into every meeting knowing what matters to them.');
  });

  it('runs scene → nothing gets missed → different on purpose → steps → what it does → privacy → plan → questions → close', () => {
    expect(headings).toEqual([
      'Walk into every meeting knowing what matters to them.',
      'Nothing gets missed.',
      'Different on purpose',
      'Three steps. No typing.',
      'What Tovira does',
      'You send chats in. Nothing goes out.',
      'One plan. Everything in it.',
      'Questions',
      'Your next client already told you something important.',
    ]);
    // the game banner sits straight after "Different on purpose"
    const banner = d.querySelector('a[data-banner]')!;
    const different = d.getElementById('different-h')!.closest('section')!;
    expect(different.nextElementSibling!.contains(banner)).toBe(true);
    // "Different on purpose" sits straight after "Nothing gets missed"
    expect(d.getElementById('missed-h')!.closest('section')!.nextElementSibling).toBe(different);
  });

  it('every CTA is a plain link to the beta request form (works with no JS), and there is no sticky bottom bar', () => {
    const ctas = [...d.querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    expect(ctas.map((a) => a.getAttribute('data-place'))).toEqual(['header', 'beat1', 'beat5', 'pricing', 'closing']);
    for (const a of ctas) { expect(a.getAttribute('href')).toBe('/request-access'); expect(a.textContent).toBe('Start free'); }
    expect(d.querySelector('[data-mobile-cta]')).toBeNull();
  });

  it('plans: one price, no urgency or discount patterns', () => {
    const plans = d.querySelector('#pricing')!;
    expect(plans.textContent).toContain('AED 299');
    expect(html).not.toMatch(/most popular|only today|countdown|was AED|<s>|strike|limited time/i);
  });

  it('the FAQ: the owner\'s two questions, as native disclosures', () => {
    expect(d.querySelectorAll('details > summary')).toHaveLength(2);
  });

  it('NEGATIVE: no answer uses a leftover-tool framing', () => {
    expect([...d.querySelectorAll('details')].map((el) => el.textContent ?? '').join(' ')).not.toMatch(/good tools already exist/i);
  });

  it('trust points make no claim beyond what is shipped', () => {
    const trust = d.querySelector('section[aria-labelledby="trust-h"]')!.textContent ?? '';
    expect(trust).toMatch(/It only receives/);
    expect(trust).toMatch(/Not used for training/);
    expect(html).not.toMatch(/bank-grade|military-grade|SOC ?2|ISO ?27001|compliance|certified/i);
  });

  it('decorative visuals are hidden (aria-hidden)', () => {
    expect(d.querySelector('.cols')!.getAttribute('aria-hidden')).toBe('true');
    for (const svg of d.querySelectorAll('main svg')) expect(svg.getAttribute('aria-hidden'), svg.outerHTML.slice(0, 60)).toBe('true');
  });
});

describe('[SITE2] motion is a progressive enhancement (no-JS + reduced-motion safe)', () => {
  it('nothing is hidden waiting for JS: the beats start stacked and visible; only html.scene-on hides them for the scene', () => {
    expect(d.querySelector('[data-reveal]')).toBeNull();
    const hiding = [...style.matchAll(/([^{}]+)\{[^}]*opacity:0[;}]/g)].map((m) => m[1]!.trim());
    for (const sel of hiding) for (const part of sel.split(',')) expect(part.trim(), sel).toMatch(/^\.scene-on /);
    // the head script adds scene-on only with motion allowed, and takes it off if the scene hasn't started in 4s
    expect(html).toMatch(/prefers-reduced-motion: reduce\)'\)\.matches\)return;d\.classList\.add\('scene-on'\)/);
    expect(html).toMatch(/setTimeout\(function\(\)\{if\(!window\.__tovScene\)d\.classList\.remove\('scene-on'\)\},4000\)/);
  });

  it('reduced motion: no scene (the stacked page), no transitions, instant scroll', () => {
    expect(style).toMatch(/@media \(prefers-reduced-motion:reduce\)\{html\{scroll-behavior:auto\}\.t2-cta,\.t2-plus\{transition:none\}/);
  });

  it('the FAQ is keyboard-navigable native disclosure (details/summary) and focus is visible', () => {
    expect(d.querySelectorAll('details > summary').length).toBe(2);
    expect(style).toMatch(/summary:focus-visible\{outline:2px solid var\(--ink\)/);
  });
});
