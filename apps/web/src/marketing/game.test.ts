// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ROUNDS } from './landing-data.js';
import { initialState, tap, next, replay, view, rankFor, roundOver, tapLimit, TOTAL_SIGS, mountGame, cardHtml, type GameState } from './game.js';

/** [P70 · owner] The landing game's state logic, ported from renderVals() in the approved design. */
const sigIdx = (r: number) => ROUNDS[r]!.msgs.flatMap((m, i) => (m.sig ? [i] : []));
const chatterIdx = (r: number) => ROUNDS[r]!.msgs.flatMap((m, i) => (m.sig ? [] : [i]));
const play = (s: GameState, taps: number[]) => taps.reduce(tap, s);

describe('[P70] game rules', () => {
  it('5 chats, 12 details; messages 5..9, details 2,2,2,3,3', () => {
    expect(ROUNDS.map((r) => r.msgs.length)).toEqual([5, 6, 7, 8, 9]);
    expect(ROUNDS.map((r) => sigIdx(ROUNDS.indexOf(r)).length)).toEqual([2, 2, 2, 3, 3]);
    expect(TOTAL_SIGS).toBe(12);
  });

  it('points per detail follow the table and spare taps go 2, 1, 1, 1, 0', () => {
    expect(ROUNDS.map((r) => r.pts)).toEqual([100, 150, 200, 300, 500]);
    expect(ROUNDS.map((r) => r.spare)).toEqual([2, 1, 1, 1, 0]);
    expect(ROUNDS.map(tapLimit)).toEqual([4, 3, 3, 4, 3]);
    expect(ROUNDS.map((r) => r.level)).toEqual(['EASY', 'WARMING UP', 'TRICKY', 'HARD', 'EXPERT · NO SPARE TAPS']);
  });

  it('a correct tap scores 100 in chat 1, glows, and shows its "Why it counts" reason', () => {
    const s = tap(initialState(), sigIdx(0)[0]!);
    const v = view(s);
    expect(v.points).toBe(100);
    expect(v.total).toBe(1);
    expect(v.tapsLeft).toBe(3);
    const m = v.msgs[sigIdx(0)[0]!]!;
    expect(m.st).toBe('hit');
    expect(m.tag).toBe('+100 · Loves the beach');
    expect(m.hasWhy).toBe(true);
    expect(m.why).toMatch(/^It's how she wants to live/);
    expect(m.pressed).toBe('true');
  });

  it('a wrong tap costs a tap, scores nothing, shakes and says it was chatter', () => {
    const i = chatterIdx(0)[0]!;
    const v = view(tap(initialState(), i));
    expect(v.tapsLeft).toBe(3);
    expect(v.points).toBe(0);
    expect(v.msgs[i]!.tag).toBe('Just chatter. Nothing here helps you close.');
    expect(v.msgs[i]!.anim).toBe('tv-shake');
    expect(v.msgs[i]!.hasWhy).toBe(false);
  });

  it('a tapped message cannot be tapped again', () => {
    const s = tap(initialState(), 0);
    expect(tap(s, 0)).toBe(s);
  });

  it('the round ends when every detail is found', () => {
    const s = play(initialState(), sigIdx(0));
    expect(roundOver(s)).toBe(true);
    expect(view(s).roundLine).toBe('You caught both. Nice.');
  });

  it('the round ends when the taps run out, and the missed details show with their reason', () => {
    const s = play(initialState(), chatterIdx(0).slice(0, 3).concat([sigIdx(0)[0]!]));
    expect(roundOver(s)).toBe(true);
    const v = view(s);
    expect(v.roundLine).toBe('You caught 1 of 2.');
    const missed = v.msgs[sigIdx(0)[1]!]!;
    expect(missed.st).toBe('missed');
    expect(missed.tag).toBe('You missed it: Husband signs off over 3M');
    expect(missed.hasWhy).toBe(true);
    expect(v.msgs.every((m) => m.disabled)).toBe(true);
    expect(tap(s, chatterIdx(0)[3] ?? 0)).toBe(s); // no taps after the round is over
  });

  it('chat 5 has no spare taps: one wrong tap means a detail is missed', () => {
    let s = initialState();
    for (let r = 0; r < 4; r++) s = next(play(s, sigIdx(r)));
    expect(view(s).roundNo).toBe(5);
    s = play(s, [chatterIdx(4)[0]!, sigIdx(4)[0]!, sigIdx(4)[1]!]);
    expect(roundOver(s)).toBe(true);
    expect(view(s).roundLine).toBe('You caught 2 of 3.');
    expect(view(s).nextLabel).toBe('See your score');
  });

  it('Next is only possible once the round is over', () => {
    const s = initialState();
    expect(next(s)).toBe(s);
  });

  it('a perfect game: 12/12, the right points, Eagle eye', () => {
    let s = initialState();
    for (let r = 0; r < 5; r++) s = next(play(s, sigIdx(r)));
    const v = view(s);
    expect(v.ended).toBe(true);
    expect(v.total).toBe(12);
    expect(v.points).toBe(2 * 100 + 2 * 150 + 2 * 200 + 3 * 300 + 3 * 500);
    expect(v.rank).toBe('Eagle eye.');
  });

  it('the end screen picks the right rank for 12, 10 and 6', () => {
    expect(rankFor(12)).toEqual({ rank: 'Eagle eye.', rankLine: 'You caught all 12. Now do it across 200 chats a week, before every meeting, without getting tired. Tovira does.' });
    expect(rankFor(10)).toEqual({ rank: 'Sharp.', rankLine: 'You missed 2, and the hard ones are the ones that win deals. Tovira caught all 12.' });
    expect(rankFor(9).rank).toBe('Sharp.');
    expect(rankFor(8).rank).toBe('Like most busy reps.');
    expect(rankFor(6)).toEqual({ rank: 'Like most busy reps.', rankLine: 'You caught 6 of 12, reading carefully, in five short chats. Real chats are longer. Tovira caught all 12, and it never gets tired.' });
  });

  it('Play again resets everything', () => {
    let s = initialState();
    for (let r = 0; r < 5; r++) s = next(play(s, sigIdx(r).slice(0, 1).concat(chatterIdx(r)).slice(0, tapLimit(ROUNDS[r]!))));
    expect(view(s).ended).toBe(true);
    expect(replay()).toEqual(initialState());
    const v = view(replay());
    expect([v.roundNo, v.points, v.total, v.tapsLeft, v.ended]).toEqual([1, 0, 0, 4, false]);
  });

  it('every one of the 12 details has a "Why it counts" reason', () => {
    for (const r of ROUNDS) for (const m of r.msgs.filter((x) => x.sig)) expect(m.why?.length ?? 0).toBeGreaterThan(20);
  });
});

describe('[P70] the game in the page (real buttons, aria-pressed, a polite live region)', () => {
  const mount = () => {
    document.body.innerHTML = `<div data-game>${cardHtml(initialState())}</div>`;
    const card = document.querySelector<HTMLElement>('[data-game]')!;
    return { card, game: mountGame(card) };
  };
  const btn = (card: HTMLElement, i: number) => card.querySelector<HTMLButtonElement>(`.tv-msg[data-i="${i}"]`)!;

  it('messages are buttons with aria-pressed; a hit sets it and updates score, taps and dots', () => {
    const { card } = mount();
    expect(card.querySelectorAll('button.tv-msg[aria-pressed="false"]')).toHaveLength(5);
    btn(card, 1).click();
    expect(btn(card, 1).getAttribute('aria-pressed')).toBe('true');
    expect(btn(card, 1).textContent).toContain('Why it counts:');
    expect(card.querySelector('[data-g="pts"]')!.textContent).toBe('100 PTS');
    expect(card.querySelector('[data-g="taps"]')!.textContent).toBe('TAPS LEFT 3');
    expect([...card.querySelector('[data-g="dots"]')!.children].filter((d) => d.getAttribute('style')!.includes('#E8643A'))).toHaveLength(1);
  });

  it('the round result appears in the aria-live="polite" region, then Next chat moves on', () => {
    const { card, game } = mount();
    btn(card, 1).click();
    btn(card, 3).click();
    const live = card.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain('You caught both. Nice.');
    expect(live.textContent).toContain('Tovira caught 2 of 2.');
    card.querySelector<HTMLButtonElement>('[data-act="next"]')!.click();
    expect(game.state().round).toBe(1);
    expect(card.textContent).toContain('CHAT 2/5 · WARMING UP');
  });

  it('a hit already shown is not re-rendered by the next tap (its pop does not replay)', () => {
    const { card } = mount();
    btn(card, 1).click();
    const tag = btn(card, 1).querySelector('.tv-pop');
    btn(card, 0).click();
    expect(btn(card, 1).querySelector('.tv-pop')).toBe(tag);
  });

  it('every tap target is at least 48px tall', () => {
    const { card } = mount();
    for (const b of card.querySelectorAll<HTMLElement>('button')) expect(b.getAttribute('style')).toMatch(/min-height:\s*(5[2-9]|4[89])px/);
    btn(card, 1).click(); btn(card, 3).click();
    expect(card.querySelector('[data-act="next"]')!.getAttribute('style')).toMatch(/min-height: 48px/);
  });
});
