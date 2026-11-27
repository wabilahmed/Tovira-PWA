// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bringCardIntoView, STACKED_QUERY } from './game.js';

/**
 * [P76 · owner] Landing page feedback. The hero loses its eyebrow and its headline is smaller (clamp(34px, 4.4vw,
 * 58px)), with the headline's first line lined up with "Would you have caught it?" on desktop (checked in Playwright);
 * the hero's Play the game button shows only when the game is stacked below (mobile). On mobile a new chat, Play again
 * or Try another industry brings the card's top just below the sticky header. The header links scroll smoothly
 * (instant with reduced motion) and land just below the header. "It shows its work" swaps two items and gets the new
 * heading (its "IT SHOWS ITS WORK" label goes: it repeated the heading); the FAQ is the owner's five questions, word for word,
 * except "family moments" is "family occasions" (owner: the P41 rule keeps "moments" off the landing page). The approved design file says the same.
 */
// [P89 · owner, Prompt 86] The P76 page is replaced by the owner's Marker page (plan/tovira-landing-marker.html; the P70
// design file is deleted). What the P76 pins protected carries over: no eyebrow, header links that scroll smoothly
// (instant with reduced motion) and land below the header, no "Not connected to your WhatsApp" wording, and the FAQ word
// for word as the owner wrote it (now two questions). The game's card-into-view behaviour below is unchanged (/game).
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const ref = readFileSync(resolve(process.cwd(), 'plan/tovira-landing-marker.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

const FAQ: Array<[string, string]> = [
  ['Do I have to connect my WhatsApp?', 'No. You export a chat and send Tovira the file.'],
  ['Who is it not for?', 'Call-centre teams on recorded calls. Tovira is for people who sell through chat: a few clients for years, or hundreds at once.'],
];

describe('[P76→P89] the hero', () => {
  it('NEGATIVE: no eyebrow above the headline, on the page or in the reference', () => {
    expect(html).not.toMatch(/FOR RELATIONSHIP SALES/i);
    expect(ref).not.toMatch(/FOR RELATIONSHIP SALES/i);
    expect(d.querySelector('h1')!.previousElementSibling).toBeNull();
  });
  it('the game button is in the header and the banner, not the hero (the game has its own pages)', () => {
    expect(STACKED_QUERY).toBe('(max-width: 899px)');
    expect(text(d.querySelector('body > header nav a[href="/game"]'))).toBe('The game');
    expect(d.querySelector('#b1 a[href*="game"]')).toBeNull();
  });
});

describe('[P76→P89] header links scroll smoothly and land below the header', () => {
  it('smooth scroll, instant with reduced motion; each target has a scroll margin', () => {
    expect(style).toContain('html{scroll-behavior:smooth}');
    expect(style).toMatch(/@media \(prefers-reduced-motion:reduce\)\{html\{scroll-behavior:auto\}/);
    for (const id of ['how', 'privacy', 'pricing']) {
      expect(d.getElementById(id), id).not.toBeNull();
      expect(d.getElementById(id)!.getAttribute('style'), id).toMatch(/scroll-margin-top: 76px/); // [P89] the header is 72px (44px buttons): the reference's 70px landed 2px under it
    }
  });
});

describe('[P76→P89] WhatsApp wording', () => {
  it('NEGATIVE: "Not connected to your WhatsApp" and "Private by design" are gone; the page says what Tovira never does', () => {
    for (const src of [html, ref]) {
      expect(src).not.toContain('Not connected to your WhatsApp');
      expect(src).not.toContain('Private by design');
    }
    expect(html).toContain('Tovira never logs in to your WhatsApp, never messages your clients and never replies for you.');
  });
});

describe('[P76→P89] the FAQ', () => {
  it('exactly the owner\'s questions and answers, word for word, in order', () => {
    const got = [...d.querySelectorAll('details')].map((el) => [text(el.querySelector('summary')), text(el.querySelector('p'))]);
    expect(got).toEqual(FAQ);
    for (const [q, a] of FAQ) { expect(ref).toContain(`<span>${q}</span>`); expect(ref).toContain(a); }
  });
  it('NEGATIVE: the removed questions are gone (owner: "Is it a CRM?" and "Why not just ask ChatGPT?")', () => {
    for (const q of ['Is it a CRM?', 'Why not just ask ChatGPT?', 'ChatGPT']) { expect(html).not.toContain(q); expect(ref).not.toContain(q); }
  });
});

describe('[P76] on mobile, a new chat brings the card into view', () => {
  // [P76-2] The smooth scroll runs frame by frame (the browser's own smooth scroll was cancelled by its 1px adjustment
  // after the card's content swap, leaving the card where it was): each frame is an instant scrollTo, ending on target.
  const fakeWin = (o: { stacked: boolean; reduced?: boolean; headerBottom?: number; cardTop: number; scrollY?: number; innerHeight?: number }) => {
    const header = { getBoundingClientRect: () => ({ bottom: o.headerBottom ?? 60 }) };
    const frames: Array<(t: number) => void> = [];
    const win = {
      matchMedia: (q: string) => ({ matches: q === STACKED_QUERY ? o.stacked : q === '(prefers-reduced-motion: reduce)' ? !!o.reduced : false }),
      document: { querySelector: (s: string) => (s === 'body > header' ? header : null) },
      scrollY: o.scrollY ?? 1000, innerHeight: o.innerHeight ?? 844,
      requestAnimationFrame: (f: (t: number) => void) => { frames.push(f); return frames.length; },
    } as unknown as Window & { scrollY: number };
    const scrollTo = vi.fn((x: { top: number }) => { win.scrollY = x.top; });
    (win as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    /** Run the queued frames, 16ms apart; `between` runs before each frame (e.g. the visitor scrolling). */
    const runFrames = (between?: (n: number) => void) => { let t = 0, n = 0; while (frames.length) { between?.(n++); frames.shift()!((t += 16)); } };
    // the card sits at a fixed place on the page: its top on screen moves as the page scrolls (shift = a late layout change)
    const page = { cardDocTop: (o.scrollY ?? 1000) + o.cardTop };
    const card = { getBoundingClientRect: () => ({ top: page.cardDocTop - win.scrollY }) } as unknown as HTMLElement;
    return { win, card, scrollTo, runFrames, page };
  };
  const smoothTo = (scrollTo: ReturnType<typeof vi.fn>, target: number) => {
    const calls = scrollTo.mock.calls.map((c) => c[0] as { top: number; behavior: string });
    expect(calls.length).toBeGreaterThan(5); // animated over several frames, not one jump
    for (const c of calls) expect(c.behavior).toBe('instant');
    expect(calls.at(-1)!.top).toBeCloseTo(target, 5);
    const tops = calls.map((c) => c.top);
    expect(tops).toEqual([...tops].sort((x, y) => (target < tops[0]! ? y - x : x - y))); // always toward the target
  };
  it('the card top is above the header: smooth-scrolls it to just below the header', () => {
    const { win, card, scrollTo, runFrames } = fakeWin({ stacked: true, cardTop: -300 });
    expect(bringCardIntoView(card, win)).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled(); // starts on the next frame: no jump
    runFrames();
    smoothTo(scrollTo, 1000 - 300 - 60 - 12);
  });
  it('the card top is under the sticky header (partly hidden): scrolls too', () => {
    const { win, card, scrollTo, runFrames } = fakeWin({ stacked: true, cardTop: 30 });
    expect(bringCardIntoView(card, win)).toBe(true);
    runFrames();
    smoothTo(scrollTo, 1000 + 30 - 72);
  });
  it('the card top is below the screen: scrolls up to it', () => {
    const { win, card, scrollTo, runFrames } = fakeWin({ stacked: true, cardTop: 900 });
    expect(bringCardIntoView(card, win)).toBe(true);
    runFrames();
    smoothTo(scrollTo, 1000 + 900 - 72);
  });
  it('something above the card shifts mid-scroll: it still lands just below the header', () => {
    const { win, card, scrollTo, runFrames, page } = fakeWin({ stacked: true, cardTop: -300 });
    bringCardIntoView(card, win);
    runFrames((n) => { if (n === 4) page.cardDocTop += 27; });
    expect(scrollTo.mock.calls.at(-1)![0].top).toBeCloseTo(1000 - 300 + 27 - 72, 5);
  });
  it('the visitor scrolls during it: it stops and leaves them be', () => {
    const { win, card, scrollTo, runFrames } = fakeWin({ stacked: true, cardTop: -300 });
    bringCardIntoView(card, win);
    runFrames((n) => { if (n === 3) win.scrollY += 200; });
    expect(scrollTo).toHaveBeenCalledTimes(3);
  });
  it('reduced motion: instant', () => {
    const { win, card, scrollTo } = fakeWin({ stacked: true, reduced: true, cardTop: -300 });
    bringCardIntoView(card, win);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 - 300 - 72, behavior: 'instant' });
  });
  it('NEGATIVE: the card top is already on screen below the header: no scroll', () => {
    const { win, card, scrollTo } = fakeWin({ stacked: true, cardTop: 200 });
    expect(bringCardIntoView(card, win)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it('NEGATIVE: desktop (side by side) never scrolls', () => {
    const { win, card, scrollTo } = fakeWin({ stacked: false, cardTop: -300 });
    expect(bringCardIntoView(card, win)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
