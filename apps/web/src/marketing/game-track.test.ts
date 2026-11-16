// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { GAMES } from './landing-data.js';
import { cardHtml, initialState, mountGame } from './game.js';
import { trackGame, gameSignedUp, GAME_CTA_KEY } from './game-track.js';

/**
 * [P71-T · owner] The game's cookieless counts: each event fires once per action, and carries only the industry, the
 * chat number and counts, a wrong-tap flag, or a score bucket (never anything typed, never an id).
 */
type Sent = Record<string, unknown>;
let sent: Sent[];
let observe: ((visible: boolean) => void) | null;
beforeEach(() => {
  sent = [];
  observe = null;
  sessionStorage.clear();
  (globalThis as Record<string, unknown>).IntersectionObserver = class {
    constructor(private cb: (e: Array<{ isIntersecting: boolean }>) => void) { observe = (v) => this.cb([{ isIntersecting: v }]); }
    observe() {} disconnect() { observe = null; }
  };
});
const mount = () => {
  document.body.innerHTML = `<div id="game"><div data-game>${cardHtml(initialState())}</div></div>`;
  const card = document.querySelector<HTMLElement>('[data-game]')!;
  const t = trackGame(document.getElementById('game')!, card, (b) => sent.push(b));
  mountGame(card, t.onChange);
  return card;
};
const click = (card: HTMLElement, sel: string) => card.querySelector<HTMLElement>(sel)!.click();
const pick = (card: HTMLElement, label: string) => [...card.querySelectorAll<HTMLElement>('[data-act="start"]')].find((b) => b.textContent === label)!.click();
const sigIdx = (gi: number, r: number) => GAMES[gi]!.chats[r]!.flatMap((m, i) => (m.sig ? [i] : []));
const ALLOWED = ['event', 'industry', 'chat', 'caught', 'details', 'wrong', 'bucket'];

describe('[P71-T] game events fire once per action', () => {
  it('game_view once, when the game box first comes into view', () => {
    mount();
    observe!(false);
    expect(sent).toEqual([]);
    observe!(true);
    expect(sent).toEqual([{ event: 'game_view' }]);
    expect(observe).toBeNull(); // stops watching after the first view
  });

  it('a whole game: start, a chat_done per chat, game_done, CTA, replay, switch', () => {
    const card = mount();
    pick(card, 'Wealth');
    expect(sent).toEqual([{ event: 'game_start', industry: 'Wealth' }]);
    // chat 1: one detail of two, then a wrong tap
    click(card, `.tv-msg[data-i="${sigIdx(2, 0)[0]}"]`);
    expect(sent).toHaveLength(1); // a correct tap is not an event
    click(card, '.tv-msg[data-i="0"]');
    expect(sent.at(-1)).toEqual({ event: 'chat_done', industry: 'Wealth', chat: 1, caught: 1, details: 2, wrong: true });
    click(card, '[data-act="next"]');
    for (let r = 1; r < 5; r++) {
      for (const i of sigIdx(2, r)) click(card, `.tv-msg[data-i="${i}"]`);
      expect(sent.at(-1)).toEqual({ event: 'chat_done', industry: 'Wealth', chat: r + 1, caught: sigIdx(2, r).length, details: sigIdx(2, r).length, wrong: false });
      click(card, '[data-act="next"]');
    }
    expect(sent.at(-1)).toEqual({ event: 'game_done', industry: 'Wealth', bucket: '10-11' });
    expect(sent.filter((e) => e.event === 'chat_done')).toHaveLength(5);
    expect(sent.filter((e) => e.event === 'game_done')).toHaveLength(1);
    const cta = card.querySelector<HTMLAnchorElement>('a[data-cta]')!;
    cta.addEventListener('click', (e) => e.preventDefault());
    cta.click();
    expect(sent.at(-1)).toEqual({ event: 'game_cta', industry: 'Wealth', bucket: '10-11' });
    expect(JSON.parse(sessionStorage.getItem(GAME_CTA_KEY)!)).toEqual({ industry: 'Wealth', bucket: '10-11' });
    click(card, '[data-act="replay"]');
    expect(sent.at(-1)).toEqual({ event: 'game_replay', industry: 'Wealth' });
    for (let r = 0; r < 5; r++) { click(card, '.tv-msg[data-i="0"]'); click(card, '[data-act="next"]'); }
    expect(sent.at(-1)).toEqual({ event: 'game_done', industry: 'Wealth', bucket: '0-3' });
    click(card, '[data-act="switch"]');
    expect(sent.at(-1)).toEqual({ event: 'game_switch' });
    expect(sent.filter((e) => e.event === 'game_start')).toHaveLength(1);
    for (const e of sent) for (const k of Object.keys(e)) expect(ALLOWED).toContain(k);
  });

  it('a sign-up counts only after a game CTA tap in the same tab, and only once', () => {
    const out: Sent[] = [];
    gameSignedUp((b) => out.push(b));
    expect(out).toEqual([]);
    sessionStorage.setItem(GAME_CTA_KEY, JSON.stringify({ industry: 'Luxury', bucket: '12' }));
    gameSignedUp((b) => out.push(b));
    gameSignedUp((b) => out.push(b));
    expect(out).toEqual([{ event: 'game_signup', industry: 'Luxury', bucket: '12' }]);
    expect(sessionStorage.getItem(GAME_CTA_KEY)).toBeNull();
  });

  it('NEGATIVE: a tampered flag sends nothing; the flag is sessionStorage only (no cookie, no localStorage)', () => {
    const out: Sent[] = [];
    sessionStorage.setItem(GAME_CTA_KEY, '{"industry":"Plumbing","bucket":"12"}');
    gameSignedUp((b) => out.push(b));
    expect(out).toEqual([]);
    expect(document.cookie).toBe('');
    expect(localStorage.length).toBe(0);
  });
});
