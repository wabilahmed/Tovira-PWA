// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAMES } from './landing-data.js';
import { initialState, start, tap, next, view, isDone, mountGame, cardHtml } from './game.js';

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
 * [P89 · owner, Prompt 86] The game moved to its own pages in the Marker look: the pick screen's six choices are links to
 * the industry pages (each page opens on its first chat), the accent is ink (#0A0A0A, was #E8643A) and the text is ink
 * on white (was #F2EDE4 on dark). The P70 design file is deleted, so its pins read the game code and /game instead.
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
    expect([...document.querySelectorAll('a.tv-pick')].map((b) => b.textContent)).toEqual(GAMES.map((g) => g.label));
    expect(text.replace(GAMES.map((g) => g.label).join(''), '')).toBe(PICK_LINE);
  });
  it('the prerendered /game page carries the same pick screen', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/web/game/index.html'), 'utf8');
    expect(html).toContain(`<div class="g-card" data-game data-gi="-1">${cardHtml(initialState())}</div>`);
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
        expect(warn.getAttribute('style')).toContain('color: #0A0A0A'); // [P89] the accent is ink in Marker
        expect(px(warn.getAttribute('style')!, 'font-size')).toBe(15);
        expect(rule.className).toContain('tv-rule');
        expect(rule.getAttribute('style')).toContain('color: #0A0A0A'); // [P89] ink on white
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
  // [P89] on the game pages the card is one column at every width (640px at most), so the rule is 17px throughout
  it('the rule size: 17px on every game page', () => {
    for (const f of ['apps/web/game/index.html', 'apps/web/game/property/index.html']) {
      const html = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(html, f).toContain('.tv-rule{font-size:17px}');
    }
  });
});

describe('[P78] the live counter', () => {
  it('goes up on each correct tap and stops when the chat ends', () => {
    const card = document.createElement('div');
    document.body.replaceChildren(card);
    // [P89] the Property page opens on its first chat
    card.innerHTML = cardHtml(start(initialState(), 0));
    mountGame(card, undefined, start(initialState(), 0));
    const counter = () => card.querySelector('[data-g="counter"]')!.textContent;
    // Property chat 3 has more than one detail: catch one, then a wrong tap ends it
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

describe('[P78→P89] the game code says the same (the design file is deleted)', () => {
  const game = readFileSync(resolve(process.cwd(), 'apps/web/src/marketing/game.ts'), 'utf8').replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  it('the pick line, the rule lines and the counter', () => {
    expect(game).toContain(`export const PICK_LINE = '${PICK_LINE}';`);
    for (const gone of ['HOW IT WORKS', 'A quick test of how well', 'CHOOSE YOUR INDUSTRY', 'Tap every useful detail']) expect(game).not.toContain(gone);
    expect(game).toContain(`export const WARN_LINE = '${WARN}';`);
    expect(game).toContain("'Find the 1 message that helps you close the deal.'");
    expect(game).toContain("' messages that help you close the deal.'");
    expect(game).toContain("found + ' of ' + sigCount + ' found'");
  });
});

// [P89 · owner, Prompt 86] Picking an industry now opens its page, which loads with the H1, then the card on its first
// chat: the rules are on screen on arrival at 390px (e2e/game-pages.spec.ts), so there is no in-place pick to scroll for.
// Next chat, Play again and Try another industry keep P76's scroll (landing-p76.test.ts).
describe('[P78→P89] picking an industry opens its page, rules first', () => {
  it('NEGATIVE: the pick screen has no in-place start (each choice is a link to its page)', () => {
    document.body.innerHTML = cardHtml(initialState());
    expect(document.querySelectorAll('[data-act="start"]')).toHaveLength(0);
    expect(document.querySelectorAll('a.tv-pick[href^="/game/"]')).toHaveLength(6);
  });
  it('an industry page opens on its first chat with the rule lines first', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/web/game/property/index.html'), 'utf8');
    const card = /<div class="g-card" data-game data-gi="0">([\s\S]*?)<\/div>\n<\/section>/.exec(html)![1]!;
    expect(card).toBe(cardHtml(start(initialState(), 0)));
    document.body.innerHTML = card;
    expect(document.body.firstElementChild!.querySelector('[data-g="rule"]')!.textContent).toBe(findLine(1));
  });
});

// [P89] the P78 fix (the headline was cut off on mobile) carries over: the page clips sideways with overflow-x: clip,
// never hidden (a hidden ancestor would break the pinned scene's sticky stage)
describe('[P78→P89] the page clips without scrolling', () => {
  it('body is overflow-x: clip (not hidden) on the landing and the game pages', () => {
    for (const f of ['apps/web/index.html', 'apps/web/game/index.html']) {
      const html = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(html, f).toMatch(/body\{overflow-x:clip\}/);
      expect(html, f).not.toMatch(/(html|body)[^{]*\{[^}]*overflow(-x)?:\s*hidden/);
    }
  });
});
