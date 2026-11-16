// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { GAMES } from './landing-data.js';
import { initialState, start, tap, next, replay, switchIndustry, view, rankFor, isDone, mountGame, cardHtml, type GameState } from './game.js';

/**
 * [P71 · owner] The hero game is now pick-your-industry: 6 industries, 5 chats each, 1 to 4 details per chat. A wrong
 * tap ends the chat and reveals every missed detail; finding every detail ends it too. Score = details caught, out of
 * the industry's 12. (Replaces the P70 game: points per chat, spare taps and levels are gone, by the owner's design.)
 */
const sigIdx = (gi: number, r: number) => GAMES[gi]!.chats[r]!.flatMap((m, i) => (m.sig ? [i] : []));
const chatterIdx = (gi: number, r: number) => GAMES[gi]!.chats[r]!.flatMap((m, i) => (m.sig ? [] : [i]));
const play = (s: GameState, taps: number[]) => taps.reduce(tap, s);
/** Play a whole industry, catching `catchN(r)` details per chat (then ending the chat with a wrong tap if any are left). */
const playAll = (gi: number, catchN: (r: number) => number) => {
  let s = start(initialState(), gi);
  for (let r = 0; r < 5; r++) {
    const sigs = sigIdx(gi, r);
    s = play(s, sigs.slice(0, catchN(r)));
    if (!isDone(s)) s = tap(s, chatterIdx(gi, r)[0]!);
    s = next(s);
  }
  return s;
};

describe('[P71] the pick screen', () => {
  it('starts on the pick screen with the six industries, in order', () => {
    const v = view(initialState());
    expect(v.phase).toBe('pick');
    expect(v.industries).toEqual(['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment']);
  });
  it('the pick screen has the hook, the 4 how-to-play steps (step 3 in bold) and 6 real buttons of 56px', () => {
    document.body.innerHTML = cardHtml(initialState());
    expect(document.body.textContent).toContain("Your clients drop details that win deals. Most reps scroll right past them. Let's see how many you catch.");
    const steps = [...document.querySelectorAll('ol li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'Pick your industry. You get 5 short client chats.',
      'Tap every message that hides a detail that would help you close: a preference, a budget, a deadline, a worry.',
      "A chat can have more than one detail. You won't know how many.",
      "Tap a message with nothing useful in it and that chat ends. We'll show you what you missed.",
    ]);
    expect(document.querySelectorAll('ol li')[2]!.querySelector('strong')!.textContent).toBe('A chat can have more than one detail.');
    expect(document.body.textContent).toContain('One point for every detail you catch.');
    const btns = [...document.querySelectorAll<HTMLButtonElement>('button[data-act="start"]')];
    expect(btns.map((b) => b.textContent)).toEqual(view(initialState()).industries);
    for (const b of btns) { expect(b.type).toBe('button'); expect(b.getAttribute('style')).toMatch(/min-height: 56px/); }
  });
});

describe('[P71] game rules', () => {
  it('picking an industry plays its chat 1, with a header, score 0 and 5 dots', () => {
    const v = view(start(initialState(), 1));
    expect(v.phase).toBe('play');
    expect(v.header).toBe('Insurance client · chat 1 of 5');
    expect(v.score).toBe(0);
    expect(v.roundDots).toHaveLength(5);
    expect(v.msgs.map((m) => m.t)).toEqual(GAMES[1]!.chats[0]!.map((m) => m.t));
  });

  it('a correct tap glows, shows "+1 · detail" and the reason, and scores', () => {
    const s = tap(start(initialState(), 0), sigIdx(0, 0)[0]!);
    const v = view(s);
    expect(v.score).toBe(1);
    const m = v.msgs[sigIdx(0, 0)[0]!]!;
    expect(m.st).toBe('hit');
    expect(m.tag).toBe('+1 · Needs 3+ bedrooms');
    expect(m.hasWhy).toBe(true);
    expect(m.why).toBe(GAMES[0]!.chats[0]![1]!.why);
    expect(m.pressed).toBe('true');
    expect(m.disabled).toBe(true);
  });

  it('a wrong tap ends the chat at once: it shakes, every missed detail is revealed with its reason, the rest is "Chatter", all locked', () => {
    let s = start(initialState(), 0);
    s = next(play(s, sigIdx(0, 0))); // chat 2 of Property has 2 details
    const wrong = chatterIdx(0, 1)[0]!;
    s = tap(s, wrong);
    expect(isDone(s)).toBe(true);
    const v = view(s);
    expect(v.msgs[wrong]!.st).toBe('wrong');
    expect(v.msgs[wrong]!.tag).toBe('Your tap: just chatter. That ended this chat.');
    expect(v.msgs[wrong]!.anim).toBe('tv-shake');
    expect(v.msgs[wrong]!.hasWhy).toBe(false);
    for (const i of sigIdx(0, 1)) {
      expect(v.msgs[i]!.st).toBe('missed');
      expect(v.msgs[i]!.tag).toBe('You missed it: ' + GAMES[0]!.chats[1]![i]!.sig);
      expect(v.msgs[i]!.hasWhy).toBe(true);
    }
    for (const i of chatterIdx(0, 1).filter((i) => i !== wrong)) { expect(v.msgs[i]!.st).toBe('chatter'); expect(v.msgs[i]!.tag).toBe('Chatter'); }
    expect(v.msgs.every((m) => m.disabled)).toBe(true);
    for (let i = 0; i < v.msgs.length; i++) expect(tap(s, i)).toBe(s); // nothing can be tapped again
    expect(v.roundLine).toBe('You missed both.');
    expect(v.roundSub).toBe('This chat had 2 useful details. Tovira caught all 2, each linked to the message it came from.');
  });

  it('finding every detail ends the chat: the chatter is marked and locked', () => {
    let s = start(initialState(), 0);
    for (let r = 0; r < 2; r++) s = next(play(s, sigIdx(0, r)));
    s = play(s, sigIdx(0, 2)); // Property chat 3: 3 details
    expect(isDone(s)).toBe(true);
    const v = view(s);
    for (const i of chatterIdx(0, 2)) { expect(v.msgs[i]!.st).toBe('chatter'); expect(v.msgs[i]!.disabled).toBe(true); }
    expect(v.roundLine).toBe('You caught all 3.');
    expect(tap(s, chatterIdx(0, 2)[0]!)).toBe(s);
  });

  it('the chat summary lines, singular and plural', () => {
    const one = start(initialState(), 0); // Property chat 1: 1 detail
    expect(view(play(one, sigIdx(0, 0))).roundLine).toBe('You caught it.');
    const missOne = view(tap(one, chatterIdx(0, 0)[0]!));
    expect(missOne.roundLine).toBe('You missed it.');
    expect(missOne.roundSub).toBe('This chat had 1 useful detail. Tovira caught it, linked to the message it came from.');
    let s = start(initialState(), 0);
    for (let r = 0; r < 4; r++) s = next(play(s, sigIdx(0, r))); // Property chat 5: 4 details
    expect(view(play(s, sigIdx(0, 4))).roundLine).toBe('You caught all 4.');
    expect(view(tap(s, chatterIdx(0, 4)[0]!)).roundLine).toBe('You missed all 4.');
    expect(view(tap(play(s, sigIdx(0, 4).slice(0, 3)), chatterIdx(0, 4)[0]!)).roundLine).toBe('You caught 3 of 4, and missed 1 detail.');
    expect(view(tap(play(s, sigIdx(0, 4).slice(0, 1)), chatterIdx(0, 4)[0]!)).roundLine).toBe('You caught 1 of 4, and missed 3 details.');
    expect(view(play(s, sigIdx(0, 4))).nextLabel).toBe('See your score');
    expect(view(play(one, sigIdx(0, 0))).nextLabel).toBe('Next chat →');
  });

  it('Next is only possible once the chat is over', () => {
    const s = start(initialState(), 0);
    expect(next(s)).toBe(s);
  });

  it('the end score is the sum of every chat, out of 12, with a dot per detail', () => {
    const s = playAll(3, (r) => [1, 1, 2, 0, 3][r]!);
    const v = view(s);
    expect(v.phase).toBe('end');
    expect(v.score).toBe(7);
    expect(v.maxScore).toBe(12);
    expect(v.scoreDots).toHaveLength(12);
    expect(v.scoreDots.filter((d) => d.includes('#E8643A'))).toHaveLength(7);
    expect(v.industryUpper).toBe('B2B ACCOUNTS');
  });

  it('the rank thresholds: 12 Eagle eye, 9 to 11 Sharp, below 9 Like most busy reps', () => {
    expect(rankFor(12, 12)).toEqual({ rank: 'Eagle eye.', rankLine: 'You caught all 12. Now do it across hundreds of chats a week, before every meeting, without getting tired. Tovira does.' });
    expect(rankFor(11, 12)).toEqual({ rank: 'Sharp, but not perfect.', rankLine: 'You missed 1 detail that would have helped you close, in five short chats. A real week has hundreds. Tovira caught all 12.' });
    expect(rankFor(9, 12).rank).toBe('Sharp, but not perfect.');
    expect(rankFor(8, 12)).toEqual({ rank: 'Like most busy reps.', rankLine: 'You missed 4 details that would have helped you close, while reading carefully, in five short chats. Real chats are longer and you are busier. Tovira caught all 12.' });
    expect(view(playAll(0, () => 4)).rank).toBe('Eagle eye.');
  });

  it('Play again keeps the industry; Try another industry goes back to the pick screen', () => {
    const end = playAll(4, () => 1);
    const again = view(replay(end));
    expect([again.phase, again.industryLabel, again.roundNo, again.score]).toEqual(['play', 'Luxury', 1, 0]);
    const pick = switchIndustry(end);
    expect(view(pick).phase).toBe('pick');
    expect(pick.results).toEqual([]);
  });
});

describe('[P71] the game in the page (real buttons, aria-pressed, a polite live region)', () => {
  const mount = () => {
    document.body.innerHTML = `<div data-game>${cardHtml(initialState())}</div>`;
    const card = document.querySelector<HTMLElement>('[data-game]')!;
    return { card, game: mountGame(card) };
  };
  const btn = (card: HTMLElement, i: number) => card.querySelector<HTMLButtonElement>(`.tv-msg[data-i="${i}"]`)!;
  const pick = (card: HTMLElement, label: string) => [...card.querySelectorAll<HTMLButtonElement>('[data-act="start"]')].find((b) => b.textContent === label)!.click();

  it('picking Property shows its chat; a hit sets aria-pressed and the score', () => {
    const { card } = mount();
    pick(card, 'Property');
    expect(card.textContent).toContain('Property client · chat 1 of 5');
    expect(card.querySelectorAll('button.tv-msg[aria-pressed="false"]')).toHaveLength(4);
    btn(card, 1).click();
    expect(btn(card, 1).getAttribute('aria-pressed')).toBe('true');
    expect(btn(card, 1).textContent).toContain('Why it counts:');
    expect(card.querySelector('[data-g="score"]')!.textContent).toBe('SCORE 1');
  });

  it('a wrong tap: the summary appears in the aria-live="polite" region and every message is disabled', () => {
    const { card, game } = mount();
    pick(card, 'Property');
    btn(card, 0).click();
    const live = card.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain('You missed it.');
    expect(live.textContent).toContain('This chat had 1 useful detail.');
    expect([...card.querySelectorAll<HTMLButtonElement>('button.tv-msg')].every((b) => b.disabled)).toBe(true);
    card.querySelector<HTMLButtonElement>('[data-act="next"]')!.click();
    expect(game.state().round).toBe(1);
    expect(card.textContent).toContain('Property client · chat 2 of 5');
  });

  it('a hit already shown is not re-rendered by the next tap (its pop does not replay)', () => {
    const { card } = mount();
    pick(card, 'Property');
    btn(card, 1).click(); // chat 1's only detail ends the chat
    card.querySelector<HTMLButtonElement>('[data-act="next"]')!.click();
    btn(card, 1).click(); // chat 2: the first of two details
    const tag = btn(card, 1).querySelector('.tv-pop');
    btn(card, 3).click();
    expect(btn(card, 1).querySelector('.tv-pop')).toBe(tag);
  });

  it('the end screen: Play again and Try another industry', () => {
    const { card } = mount();
    pick(card, 'Wealth');
    for (let r = 0; r < 5; r++) { btn(card, chatterIdx(2, r)[0]!).click(); card.querySelector<HTMLButtonElement>('[data-act="next"]')!.click(); }
    expect(card.textContent).toContain('YOUR SCORE · WEALTH');
    expect(card.textContent).toContain('0/12');
    expect(card.textContent).toContain('Like most busy reps.');
    const cta = card.querySelector<HTMLAnchorElement>('a[data-cta]')!;
    expect([cta.textContent, cta.getAttribute('href')]).toEqual(['Let Tovira catch them for you', '/request-access']);
    card.querySelector<HTMLButtonElement>('[data-act="replay"]')!.click();
    expect(card.textContent).toContain('Wealth client · chat 1 of 5');
    for (let r = 0; r < 5; r++) { btn(card, chatterIdx(2, r)[0]!).click(); card.querySelector<HTMLButtonElement>('[data-act="next"]')!.click(); }
    card.querySelector<HTMLButtonElement>('[data-act="switch"]')!.click();
    expect(card.querySelectorAll('[data-act="start"]')).toHaveLength(6);
  });

  it('every tap target is at least 48px tall', () => {
    const { card } = mount();
    const check = () => { for (const b of card.querySelectorAll<HTMLElement>('button')) expect(b.getAttribute('style')).toMatch(/min-height:\s*(5[2-9]|4[89])px/); };
    check();
    pick(card, 'Property');
    check();
    btn(card, 0).click();
    check();
  });
});
