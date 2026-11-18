// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAMES, ACCENT } from './landing-data.js';
import { initialState, start, tap, next, view, isDone, mountGame, cardHtml } from './game.js';
import { fragmentsIn } from './landing-render.js';

/**
 * [P78 · owner] Game clarity fix ("people didn't understand what to do; the instructions are too long, nobody reads
 * them"):
 *  - the pick screen is one line, "Clients drop details that win deals. Can you spot them? Pick your industry to start.",
 *    then the 6 industry buttons (HOW IT WORKS, the intro paragraph and the CHOOSE YOUR INDUSTRY label are gone);
 *  - every chat starts with the rules, big and bold: "Find the N messages that help you close the deal." (singular for
 *    1), N being that chat's useful details, then "Pick a wrong one and you fail this chat." in bold accent 15px;
 *  - below them a live counter, "0 of N found", up by one on each correct tap, frozen once the chat ends;
 *  - "[Industry] client · chat n of 5" and the score pill stay, smaller than the rule lines.
 * Data, scoring, the summary, the reveal and the tracking don't change.
 */
const sigIdx = (gi: number, r: number) => GAMES[gi]!.chats[r]!.flatMap((m, i) => (m.sig ? [i] : []));
const chatterIdx = (gi: number, r: number) => GAMES[gi]!.chats[r]!.flatMap((m, i) => (m.sig ? [] : [i]));
const PICK_LINE = 'Clients drop details that win deals. Can you spot them? Pick your industry to start.';
const findLine = (n: number) => (n === 1 ? 'Find the 1 message that helps you close the deal.' : `Find the ${n} messages that help you close the deal.`);
const WARN = 'Pick a wrong one and you fail this chat.';
const px = (style: string, prop: string) => Number(new RegExp(`${prop}:\\s*(\\d+)px`).exec(style)?.[1] ?? NaN);

describe('[P78] the pick screen', () => {
  it('shows only the one-line summary, then the 6 industry buttons', () => {
    document.body.innerHTML = cardHtml(initialState());
    const ps = [...document.querySelectorAll('p')];
    expect(ps.map((p) => p.textContent)).toEqual([PICK_LINE]);
    const text = document.body.textContent!;
    for (const gone of ['HOW IT WORKS', 'A quick test of how well', 'CHOOSE YOUR INDUSTRY', 'One wrong tap ends that chat', 'One point per detail']) expect(text).not.toContain(gone);
    expect(document.querySelectorAll('ol, li')).toHaveLength(0);
    expect([...document.querySelectorAll('button[data-act="start"]')].map((b) => b.textContent)).toEqual(GAMES.map((g) => g.label));
    expect(text.replace(GAMES.map((g) => g.label).join(''), '')).toBe(PICK_LINE);
  });
  it('the prerendered page carries the same pick screen', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
    expect(fragmentsIn(html).game).toBe(cardHtml(initialState()));
    expect(html).not.toContain('HOW IT WORKS');
  });
});

describe('[P78] every chat starts with the rules', () => {
  it('every chat of every industry shows its own N, singular for 1 and plural otherwise, and the bold warning', () => {
    const seen = new Set<number>();
    GAMES.forEach((g, gi) => {
      let s = start(initialState(), gi);
      for (let r = 0; r < 5; r++) {
        const n = sigIdx(gi, r).length;
        seen.add(n);
        const v = view(s);
        expect(v.findLine, `${g.label} chat ${r + 1}`).toBe(findLine(n));
        expect(v.counter).toBe(`0 of ${n} found`);
        document.body.innerHTML = cardHtml(s);
        const rule = document.querySelector<HTMLElement>('[data-g="rule"]')!;
        const warn = document.querySelector<HTMLElement>('[data-g="warn"]')!;
        expect(rule.textContent).toBe(findLine(n));
        expect(warn.textContent).toBe(WARN);
        expect(warn.style.fontWeight).toBe('700');
        expect(rule.style.fontWeight).toBe('700');
        expect(warn.getAttribute('style')).toContain(`color: ${ACCENT}`);
        expect(ACCENT.toUpperCase()).toBe('#E8643A');
        expect(px(warn.getAttribute('style')!, 'font-size')).toBe(15);
        expect(rule.className).toContain('tv-rule');
        expect(rule.getAttribute('style')).toContain('color: #F2EDE4');
        s = next(tap(s, chatterIdx(gi, r)[0]!));
      }
    });
    expect([...seen].sort()).toEqual([1, 2, 3]); // the data has all three counts, so both forms are exercised
  });
  it('the rule lines come first, and the chat label and score pill are smaller than both', () => {
    document.body.innerHTML = cardHtml(start(initialState(), 0));
    const order = [...document.querySelectorAll('[data-g]')].map((e) => e.getAttribute('data-g'));
    expect(order.slice(0, 3)).toEqual(['rule', 'warn', 'counter']);
    const meta = document.querySelector<HTMLElement>('[data-g="meta"]')!;
    const score = document.querySelector<HTMLElement>('[data-g="score"]')!;
    expect(meta.textContent).toBe('Property client · chat 1 of 5');
    expect(score.textContent).toBe('SCORE 0');
    for (const el of [meta, score]) expect(px(el.getAttribute('style')!, 'font-size')).toBeLessThan(15);
  });
  it('the rule sizes: 17px on mobile, 18px from 900px (page and design file)', () => {
    for (const f of ['apps/web/index.html', 'plan/tovira-landing-reference.dc.html']) {
      const html = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(html, f).toContain('.tv-rule{font-size:17px}');
      expect(html, f).toMatch(/@media \(min-width: 900px\)\{[^\n]*\.tv-rule\{font-size:18px\}/);
    }
  });
});

describe('[P78] the live counter', () => {
  it('goes up on each correct tap and stops when the chat ends', () => {
    const card = document.createElement('div');
    document.body.replaceChildren(card);
    card.innerHTML = cardHtml(initialState());
    mountGame(card);
    const counter = () => card.querySelector('[data-g="counter"]')!.textContent;
    // Property chat 3 has more than one detail: catch one, then a wrong tap ends it
    (card.querySelector('[data-act="start"][data-gi="0"]') as HTMLElement).click();
    const r = GAMES[0]!.chats.findIndex((c) => c.filter((m) => m.sig).length >= 2);
    for (let i = 0; i < r; i++) {
      for (const j of sigIdx(0, i)) (card.querySelector(`[data-i="${j}"]`) as HTMLElement).click();
      (card.querySelector('[data-act="next"]') as HTMLElement).click();
    }
    const n = sigIdx(0, r).length;
    expect(counter()).toBe(`0 of ${n} found`);
    (card.querySelector(`[data-i="${sigIdx(0, r)[0]}"]`) as HTMLElement).click();
    expect(counter()).toBe(`1 of ${n} found`);
    (card.querySelector(`[data-i="${chatterIdx(0, r)[0]}"]`) as HTMLElement).click(); // the chat ends
    expect(counter()).toBe(`1 of ${n} found`);
    for (const j of sigIdx(0, r).slice(1)) (card.querySelector(`[data-i="${j}"]`) as HTMLElement).click(); // locked
    expect(counter()).toBe(`1 of ${n} found`);
    expect(card.querySelector('[data-g="warn"]')!.textContent).toBe(WARN);
  });
  it('NEGATIVE: a wrong tap never counts, and a finished chat never moves', () => {
    let s = start(initialState(), 0);
    const n = sigIdx(0, 0).length;
    s = tap(s, chatterIdx(0, 0)[0]!);
    expect(isDone(s)).toBe(true);
    expect(view(s).counter).toBe(`0 of ${n} found`);
    expect(view(tap(s, sigIdx(0, 0)[0]!)).counter).toBe(`0 of ${n} found`);
  });
  it('nothing else changes: the summary, the reveal and the score after a full chat', () => {
    const s = sigIdx(0, 0).reduce(tap, start(initialState(), 0));
    const v = view(s);
    expect(v.done).toBe(true);
    expect(v.roundLine).toBe('You caught it.');
    expect(v.score).toBe(1);
    expect(v.counter).toBe('1 of 1 found');
  });
});

describe('[P78] the design file says the same', () => {
  const ref = readFileSync(resolve(process.cwd(), 'plan/tovira-landing-reference.dc.html'), 'utf8');
  it('the pick line, the rule lines and the counter', () => {
    expect(ref).toContain(`>${PICK_LINE}</p>`);
    for (const gone of ['HOW IT WORKS', 'A quick test of how well', 'CHOOSE YOUR INDUSTRY', 'Tap every useful detail']) expect(ref).not.toContain(gone);
    expect(ref).toContain('{{findLine}}');
    expect(ref).toContain(`>${WARN}</div>`);
    expect(ref).toContain('{{counter}}');
    expect(ref).toContain("'Find the 1 message that helps you close the deal.'");
    expect(ref).toContain("' messages that help you close the deal.'");
    expect(ref).toContain("' of ' + sigCount + ' found'");
  });
});

describe('[P78] on mobile, picking an industry starts with the rules on screen', () => {
  // Found in Playwright under load at 390: with the card's top scrolled above the screen, picking an industry left the
  // first chat's rule lines out of sight. Picking an industry now brings the card's top under the header, like P76's
  // Next chat, Play again and Try another industry (mobile only; decided before the card re-renders).
  const setup = (o: { stacked: boolean; cardTop: number }) => {
    const card = document.createElement('div');
    document.body.replaceChildren(card);
    card.innerHTML = cardHtml(initialState());
    card.getBoundingClientRect = () => ({ top: o.cardTop } as DOMRect);
    const calls: Array<{ top: number; behavior: string }> = [];
    Object.assign(window, {
      matchMedia: (q: string) => ({ matches: q === '(max-width: 899px)' ? o.stacked : q === '(prefers-reduced-motion: reduce)' }),
      scrollTo: (x: { top: number; behavior: string }) => { calls.push(x); },
    });
    mountGame(card);
    (card.querySelector('[data-act="start"][data-gi="0"]') as HTMLElement).click();
    return calls;
  };
  it('the card top above the screen: it scrolls to the card (instant with reduced motion)', () => {
    const calls = setup({ stacked: true, cardTop: -86 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.behavior).toBe('instant');
    expect(calls[0]!.top).toBe(window.scrollY - 86 - 12); // no header in this page: 12px below the top
  });
  it('NEGATIVE: the card already on screen, or desktop: no scroll', () => {
    expect(setup({ stacked: true, cardTop: 200 })).toHaveLength(0);
    expect(setup({ stacked: false, cardTop: -86 })).toHaveLength(0);
  });
});

describe('[P78] the hero section clips without scrolling', () => {
  it('section#top is overflow: clip (not hidden) in the page and the design file', () => {
    for (const f of ['apps/web/index.html', 'plan/tovira-landing-reference.dc.html']) {
      const html = readFileSync(resolve(process.cwd(), f), 'utf8');
      const tag = /<section id="top"[^>]*>/.exec(html)![0];
      expect(tag, f).toContain('overflow: clip');
      expect(tag, f).not.toContain('overflow: hidden');
    }
  });
});
