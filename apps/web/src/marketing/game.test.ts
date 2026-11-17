// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { GAMES } from './landing-data.js';
import { initialState, start, tap, next, replay, switchIndustry, view, rankFor, isDone, mountGame, cardHtml, type GameState } from './game.js';

/**
 * [P71 · owner] The hero game is now pick-your-industry: 6 industries, 5 chats each. A wrong tap ends the chat and
 * reveals every missed detail; finding every detail ends it too. (Replaces the P70 game: points per chat, spare taps and
 * levels are gone, by the owner's design.)
 * [P73 · owner] "A real challenge": every chat has 5 messages and 1 to 3 details; the wrong answers are believable traps.
 * A wrong tap says "Not a buying signal" with its "Why not" reason; the other traps say "Not a signal". The score is out
 * of the industry's own total (10 or 11). The pick screen is "HOW IT WORKS" in 5 steps. The tap-target floor follows the
 * brand's 44px minimum (docs/tovira-brand.md; the owner's Block C draws messages at 46px).
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
  it('[P73] the pick screen: the hook, HOW IT WORKS in 5 steps (steps 4 and 5 in bold), and 6 real buttons of 48px in an auto-fit grid', () => {
    document.body.innerHTML = cardHtml(initialState());
    expect(document.body.textContent).toContain('A quick test of how well you read client chats. Clients drop details that win deals, usually between the small talk. Most reps scroll right past them.');
    expect(document.body.textContent).toContain('HOW IT WORKS');
    expect(document.body.textContent).not.toContain('HOW TO PLAY');
    const steps = [...document.querySelectorAll('ol li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'Choose your industry. You get 5 client chats, each with 5 messages.',
      'Tap every message with a detail that would help you close: something specific to this client, like what they love, their budget, a deadline, a worry or who else has a say.',
      "Skip the rest. Polite replies, scheduling and things every client says don't count, however good they sound.",
      "Every chat has at least one useful detail, and some have up to three. You won't know how many.",
      'One wrong tap ends that chat. We then show every detail you missed, and why each one matters.',
    ]);
    expect(document.querySelectorAll('ol li')[3]!.querySelector('strong')!.textContent).toBe('Every chat has at least one useful detail, and some have up to three.');
    expect(document.querySelectorAll('ol li')[4]!.querySelector('strong')!.textContent).toBe('One wrong tap ends that chat.');
    expect(document.body.textContent).toContain('One point per detail caught. Your score shows at the end.');
    expect(document.body.innerHTML).toContain('grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px');
    const btns = [...document.querySelectorAll<HTMLButtonElement>('button[data-act="start"]')];
    expect(btns.map((b) => b.textContent)).toEqual(view(initialState()).industries);
    for (const b of btns) { expect(b.type).toBe('button'); expect(b.getAttribute('style')).toMatch(/min-height: 48px/); }
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

  it('[P73] a wrong tap ends the chat at once: "Not a buying signal" with its "Why not" reason, every missed detail with "Why it counts", the other traps "Not a signal", all locked', () => {
    let s = start(initialState(), 0);
    s = next(play(s, sigIdx(0, 0))); // chat 2 of Property has 2 details
    const wrong = chatterIdx(0, 1)[0]!;
    s = tap(s, wrong);
    expect(isDone(s)).toBe(true);
    const v = view(s);
    expect(v.msgs[wrong]!.st).toBe('wrong');
    expect(v.msgs[wrong]!.tag).toBe('Not a buying signal. That ended this chat.');
    expect(v.msgs[wrong]!.anim).toBe('tv-shake');
    expect(v.msgs[wrong]!.hasWhy).toBe(true);
    expect(v.msgs[wrong]!.whyLabel).toBe('Why not: ');
    expect(v.msgs[wrong]!.why).toBe(GAMES[0]!.chats[1]![wrong]!.why);
    for (const i of sigIdx(0, 1)) {
      expect(v.msgs[i]!.st).toBe('missed');
      expect(v.msgs[i]!.tag).toBe('You missed it: ' + GAMES[0]!.chats[1]![i]!.sig);
      expect(v.msgs[i]!.hasWhy).toBe(true);
      expect(v.msgs[i]!.whyLabel).toBe('Why it counts: ');
    }
    for (const i of chatterIdx(0, 1).filter((i) => i !== wrong)) { expect(v.msgs[i]!.st).toBe('chatter'); expect(v.msgs[i]!.tag).toBe('Not a signal'); expect(v.msgs[i]!.hasWhy).toBe(false); }
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

  it('[P73] the reason line in the page: "Why it counts: " on a detail, "Why not: " on the trap that ended the chat', () => {
    let s = start(initialState(), 0);
    s = tap(s, sigIdx(0, 0)[0]!);
    document.body.innerHTML = cardHtml(s);
    expect(document.querySelectorAll('.tv-msg')[sigIdx(0, 0)[0]!]!.textContent).toContain('Why it counts: ' + GAMES[0]!.chats[0]![1]!.why);
    s = tap(next(s), chatterIdx(0, 1)[0]!);
    document.body.innerHTML = cardHtml(s);
    const wrongBtn = document.querySelectorAll('.tv-msg')[chatterIdx(0, 1)[0]!]!;
    expect(wrongBtn.textContent).toContain('Not a buying signal. That ended this chat.');
    expect(wrongBtn.textContent).toContain('Why not: ' + GAMES[0]!.chats[1]![chatterIdx(0, 1)[0]!]!.why);
    expect(document.body.textContent).toContain('Tap every useful detail. At least one, maybe more.');
  });

  it('the chat summary lines, singular and plural', () => {
    const one = start(initialState(), 0); // Property chat 1: 1 detail
    expect(view(play(one, sigIdx(0, 0))).roundLine).toBe('You caught it.');
    const missOne = view(tap(one, chatterIdx(0, 0)[0]!));
    expect(missOne.roundLine).toBe('You missed it.');
    expect(missOne.roundSub).toBe('This chat had 1 useful detail. Tovira caught it, linked to the message it came from.');
    let s = start(initialState(), 0);
    for (let r = 0; r < 4; r++) s = next(play(s, sigIdx(0, r))); // Property chat 5: 3 details
    expect(view(play(s, sigIdx(0, 4))).roundLine).toBe('You caught all 3.');
    expect(view(tap(s, chatterIdx(0, 4)[0]!)).roundLine).toBe('You missed all 3.');
    expect(view(tap(play(s, sigIdx(0, 4).slice(0, 2)), chatterIdx(0, 4)[0]!)).roundLine).toBe('You caught 2 of 3, and missed 1 detail.');
    expect(view(tap(play(s, sigIdx(0, 4).slice(0, 1)), chatterIdx(0, 4)[0]!)).roundLine).toBe('You caught 1 of 3, and missed 2 details.');
    expect(view(play(s, sigIdx(0, 4))).nextLabel).toBe('See your score');
    expect(view(play(one, sigIdx(0, 0))).nextLabel).toBe('Next chat →');
  });

  it('Next is only possible once the chat is over', () => {
    const s = start(initialState(), 0);
    expect(next(s)).toBe(s);
  });

  it('[P73] the end score is the sum of every chat, out of that industry\'s own total, with a dot per detail', () => {
    const s = playAll(3, (r) => [1, 1, 2, 0, 3][r]!);
    const v = view(s);
    expect(v.phase).toBe('end');
    expect(v.score).toBe(7);
    expect(v.maxScore).toBe(11); // B2B: 1 + 2 + 3 + 2 + 3
    expect(v.scoreDots).toHaveLength(11);
    expect(view(playAll(1, () => 3)).maxScore).toBe(10); // Insurance: 1 + 3 + 2 + 2 + 2
    expect(view(playAll(1, () => 3)).score).toBe(10);
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
    expect(card.querySelectorAll('button.tv-msg[aria-pressed="false"]')).toHaveLength(5);
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
    btn(card, 0).click(); // chat 2: the first of two details
    const tag = btn(card, 0).querySelector('.tv-pop');
    btn(card, 2).click();
    expect(btn(card, 0).querySelector('.tv-pop')).toBe(tag);
  });

  it('the end screen: Play again and Try another industry', () => {
    const { card } = mount();
    pick(card, 'Wealth');
    for (let r = 0; r < 5; r++) { btn(card, chatterIdx(2, r)[0]!).click(); card.querySelector<HTMLButtonElement>('[data-act="next"]')!.click(); }
    expect(card.textContent).toContain('YOUR SCORE · WEALTH');
    expect(card.textContent).toContain('0/11');
    expect(card.textContent).toContain('Like most busy reps.');
    const cta = card.querySelector<HTMLAnchorElement>('a[data-cta]')!;
    expect([cta.textContent, cta.getAttribute('href')]).toEqual(['Let Tovira catch them for you', '/request-access']);
    card.querySelector<HTMLButtonElement>('[data-act="replay"]')!.click();
    expect(card.textContent).toContain('Wealth client · chat 1 of 5');
    for (let r = 0; r < 5; r++) { btn(card, chatterIdx(2, r)[0]!).click(); card.querySelector<HTMLButtonElement>('[data-act="next"]')!.click(); }
    card.querySelector<HTMLButtonElement>('[data-act="switch"]')!.click();
    expect(card.querySelectorAll('[data-act="start"]')).toHaveLength(6);
  });

  it('every tap target is at least 44px tall (the brand minimum)', () => {
    const { card } = mount();
    const check = () => { for (const b of card.querySelectorAll<HTMLElement>('button')) expect(b.getAttribute('style')).toMatch(/min-height:\s*(5[0-9]|4[4-9])px/); };
    check();
    pick(card, 'Property');
    check();
    btn(card, 0).click();
    check();
  });
});
