/**
 * [P71 · owner] "Would you have caught it?": the pick-your-industry landing game, ported from renderVals() in the
 * approved P70 design (since replaced by plan/tovira-landing-marker.html; the game moved to /game in P89). Pick an industry, play its 5 chats. A wrong tap ends the chat
 * and reveals every missed detail; finding every detail ends it too. Score = details caught, out of the industry's total.
 * [P73 · owner] 5 messages per chat, 1 to 3 details; a wrong tap says "Not a buying signal" with its "Why not" reason,
 * the other traps "Not a signal"; HOW IT WORKS in 5 steps; a smaller card (Blocks A and C of the design, word for word).
 * Pure state logic plus HTML-string views, so the same code renders the prerendered pick screen in index.html (pinned
 * by a test) and every state after it in the browser. No libraries.
 * [P78 · owner] Clarity: the pick screen is one line, then the industries (HOW IT WORKS is gone, nobody read it). Every
 * chat starts with its rules, big and bold: "Find the N messages that help you close the deal." (N from the data) and
 * "Pick a wrong one and you fail this chat.", then a live "x of N found" counter; the chat label and score are smaller.
 */
import { GAMES, type Msg } from './landing-data.js';

export type Phase = 'pick' | 'play' | 'end';
export interface GameState { gi: number; phase: Phase; round: number; tapped: number[]; results: number[]; shakeAt: number }

export const initialState = (): GameState => ({ gi: -1, phase: 'pick', round: 0, tapped: [], results: [], shakeAt: -1 });

const gameOf = (s: GameState) => GAMES[Math.max(0, s.gi)]!;
const chatOf = (s: GameState): Msg[] => gameOf(s).chats[Math.min(s.round, 4)]!;
const sigsIn = (c: Msg[]): number => c.filter((m) => m.sig).length;
const foundIn = (s: GameState, c: Msg[]): number => s.tapped.filter((i) => c[i]!.sig).length;
const wrongIn = (s: GameState, c: Msg[]): boolean => s.tapped.some((i) => !c[i]!.sig);
export const maxScoreOf = (gi: number): number => GAMES[gi]!.chats.reduce((a, c) => a + sigsIn(c), 0);

/** A chat is over after one wrong tap, or once every detail is found. */
export const isDone = (s: GameState): boolean => { const c = chatOf(s); return s.phase === 'play' && (wrongIn(s, c) || foundIn(s, c) === sigsIn(c)); };

export const start = (_s: GameState, gi: number): GameState => ({ gi, phase: 'play', round: 0, tapped: [], results: [], shakeAt: -1 });

export function tap(s: GameState, i: number): GameState {
  const c = chatOf(s);
  if (s.phase !== 'play' || isDone(s) || s.tapped.includes(i) || !c[i]) return s;
  return { ...s, tapped: s.tapped.concat([i]), shakeAt: c[i]!.sig ? -1 : i };
}

export function next(s: GameState): GameState {
  if (!isDone(s)) return s;
  const results = s.results.concat([foundIn(s, chatOf(s))]);
  if (s.round >= 4) return { ...s, results, phase: 'end', tapped: [], shakeAt: -1 };
  return { ...s, results, round: s.round + 1, tapped: [], shakeAt: -1 };
}

/** Play again: the same industry, from chat 1. */
export const replay = (s: GameState): GameState => ({ ...s, phase: 'play', round: 0, tapped: [], results: [], shakeAt: -1 });
/** Try another industry: back to the pick screen. */
export const switchIndustry = (s: GameState): GameState => ({ ...s, phase: 'pick', round: 0, tapped: [], results: [], shakeAt: -1 });

const plural = (n: number, w: string): string => n + ' ' + w + (n === 1 ? '' : 's');

export function rankFor(score: number, max: number): { rank: string; rankLine: string } {
  const missed = max - score;
  if (score >= max) return { rank: 'Eagle eye.', rankLine: 'You caught all ' + max + '. Now do it across hundreds of chats a week, before every meeting, without getting tired. Tovira does.' };
  if (score >= Math.ceil(max * 0.75)) return { rank: 'Sharp, but not perfect.', rankLine: 'You missed ' + plural(missed, 'detail') + ' that would have helped you close, in five short chats. A real week has hundreds. Tovira caught all ' + max + '.' };
  return { rank: 'Like most busy reps.', rankLine: 'You missed ' + plural(missed, 'detail') + ' that would have helped you close, while reading carefully, in five short chats. Real chats are longer and you are busier. Tovira caught all ' + max + '.' };
}

export type MsgState = 'idle' | 'hit' | 'wrong' | 'missed' | 'chatter';
export interface MsgView { t: string; st: MsgState; style: string; tag: string; tagStyle: string; hasTag: boolean; why: string; whyLabel: string; hasWhy: boolean; anim: string; pressed: 'true' | 'false'; disabled: boolean }
export interface GameView {
  phase: Phase; industries: string[]; industryLabel: string; industryUpper: string; header: string; roundNo: number;
  findLine: string; counter: string;
  msgs: MsgView[]; done: boolean; roundLine: string; roundSub: string; roundDots: string[]; scoreDots: string[];
  score: number; maxScore: number; nextLabel: string; rank: string; rankLine: string;
}

// [P89 · owner, Prompt 86] The Marker look (plan/brand.md): a white card, ink text, the caught message marked in yellow
// and tilted one degree as if marked by hand, small labels in Geist 600 uppercase. Rules, content and scoring unchanged.
const BASE = 'display:block;width:100%;min-height:46px;padding:10px 14px;border-radius:16px 16px 16px 4px;color:#0A0A0A;';
const LABEL = 'display:inline-block;margin-top:6px;font-family:Geist,"Geist Fallback",system-ui,sans-serif;font-size:12px;font-weight:600;letter-spacing:.06em;';
const MSG_STYLES: Record<MsgState, string> = {
  idle: BASE + 'background:#F2F2F2;border:1px solid #E6E6E6',
  hit: BASE + 'background:#FFE45C;border:1px solid #FFE45C;transform:rotate(-1deg)',
  wrong: BASE + 'background:#FFFFFF;color:#5A5A5F;border:1px solid #0A0A0A',
  missed: BASE + 'background:#F2F2F2;border:2px dashed #0A0A0A',
  chatter: BASE + 'background:#FFFFFF;color:#5A5A5F;border:1px solid #E6E6E6',
};
const TAG_STYLES: Record<MsgState, string> = {
  idle: '',
  hit: LABEL + 'background:#0A0A0A;color:#FFFFFF;border-radius:999px;padding:4px 10px',
  wrong: LABEL + 'color:#0A0A0A',
  missed: LABEL + 'color:#0A0A0A',
  chatter: LABEL + 'color:#5A5A5F',
};
const DOT = 'flex:1 1 0;min-width:0;height:6px;border-radius:999px;background:';
const INK = '#0A0A0A';

export function view(s: GameState): GameView {
  const game = gameOf(s);
  const chat = chatOf(s);
  const maxScore = maxScoreOf(Math.max(0, s.gi));
  const sigCount = sigsIn(chat);
  const found = foundIn(s, chat);
  const wrong = wrongIn(s, chat);
  const done = isDone(s);
  const score = s.results.reduce((a, r) => a + r, 0) + (s.phase === 'play' ? found : 0);
  const msgs = chat.map((m, i): MsgView => {
    const tapped = s.tapped.includes(i);
    let st: MsgState = 'idle';
    if (tapped && m.sig) st = 'hit';
    else if (tapped) st = 'wrong';
    else if (done && m.sig) st = 'missed';
    else if (done) st = 'chatter';
    const tags: Record<MsgState, string> = { idle: '', hit: '+1 · ' + m.sig, wrong: 'Not a buying signal. That ended this chat.', missed: 'You missed it: ' + m.sig, chatter: 'Not a signal' };
    return {
      t: m.t, st, style: MSG_STYLES[st], tag: tags[st], tagStyle: TAG_STYLES[st], hasTag: st !== 'idle', why: m.why ?? '',
      whyLabel: m.sig ? 'Why it counts: ' : 'Why not: ', hasWhy: st === 'hit' || st === 'missed' || st === 'wrong', anim: st === 'wrong' && s.shakeAt === i ? 'tv-shake' : '', pressed: tapped ? 'true' : 'false', disabled: tapped || done,
    };
  });
  const all = (n: number) => (n === 1 ? 'it' : n === 2 ? 'both' : 'all ' + n);
  let roundLine = 'You caught ' + all(sigCount) + '.';
  if (wrong) roundLine = found === 0 ? 'You missed ' + all(sigCount) + '.' : 'You caught ' + found + ' of ' + sigCount + ', and missed ' + plural(sigCount - found, 'detail') + '.';
  const roundSub = 'This chat had ' + plural(sigCount, 'useful detail') + '. ' + (sigCount === 1 ? 'Tovira caught it, linked to the message it came from.' : 'Tovira caught all ' + sigCount + ', each linked to the message it came from.');
  const roundDots = [0, 1, 2, 3, 4].map((i) => DOT + (i < s.round || (i === s.round && done) ? INK : i === s.round ? '#6B6B70' : '#E6E6E6'));
  const scoreDots: string[] = [];
  for (let i = 0; i < maxScore; i++) scoreDots.push(DOT + (i < score ? INK : '#E6E6E6'));
  return {
    phase: s.phase, industries: GAMES.map((g) => g.label), industryLabel: game.label, industryUpper: game.label.toUpperCase(),
    header: game.label + ' client · chat ' + (s.round + 1) + ' of 5', roundNo: s.round + 1,
    findLine: sigCount === 1 ? 'Find the 1 message that helps you close the deal.' : 'Find the ' + sigCount + ' messages that help you close the deal.',
    counter: found + ' of ' + sigCount + ' found',
    msgs, done, roundLine, roundSub, roundDots, scoreDots, score, maxScore, nextLabel: s.round >= 4 ? 'See your score' : 'Next chat →', ...rankFor(score, maxScore),
  };
}

// ---- HTML views (Marker, P89) ----

export const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SMALL = 'font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase';

export const PICK_LINE = 'Clients drop details that win deals. Can you spot them? Pick your industry to start.';
export const WARN_LINE = 'Pick a wrong one and you fail this chat.';

/** [P89 · owner, Prompt 86] Each industry is a real page that starts its game. */
export const SLUGS = ['property', 'insurance', 'wealth', 'b2b', 'luxury', 'recruitment'] as const;
export const industryHref = (gi: number): string => `/game/${SLUGS[gi]}`;

export function pickHtml(v: GameView): string {
  return `<div style="display: flex; flex-direction: column; gap: 14px">`
    + `<p style="margin: 0; font-size: 15px; line-height: 1.5; color: #0A0A0A">${PICK_LINE}</p>`
    + `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px">`
    + v.industries.map((label, i) => `<a class="tv-btn tv-pick" href="${industryHref(i)}" style="display: flex; align-items: center; background: #F2F2F2; color: #0A0A0A; border: 1px solid #E6E6E6; border-radius: 14px; padding: 12px 14px; min-height: 48px; font-size: 15px; font-weight: 600; text-decoration: none">${esc(label)}</a>`).join('')
    + `</div>`
    + `</div>`;
}

export function msgInner(m: MsgView): string {
  return `<span style="display: block; font-size: 15px; line-height: 1.4">${esc(m.t)}</span>`
    + (m.hasTag ? `<span class="tv-pop" style="${esc(m.tagStyle)}">${esc(m.tag)}</span>` : '')
    + (m.hasWhy ? `<span class="tv-pop" style="display: block; margin-top: 6px; font-size: 13px; line-height: 1.5; color: #0A0A0A"><span style="font-weight: 600">${esc(m.whyLabel)}</span>${esc(m.why)}</span>` : '');
}

export function msgButton(m: MsgView, i: number): string {
  return `<button class="tv-msg${m.anim ? ' ' + m.anim : ''}" type="button" data-i="${i}"${m.disabled ? ' disabled' : ''} aria-pressed="${m.pressed}" style="${esc(m.style)}">${msgInner(m)}</button>`;
}

export function resultHtml(v: GameView): string {
  if (!v.done) return '';
  return `<div class="tv-pop" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; border-top: 1px solid #E6E6E6; padding-top: 18px">`
    + `<div style="display: flex; flex-direction: column; gap: 4px; flex: 1 1 240px; min-width: 0"><div style="font-weight: 600; font-size: 17px">${esc(v.roundLine)}</div><div style="font-size: 14px; color: #5A5A5F">${esc(v.roundSub)}</div></div>`
    + `<button class="tv-btn" type="button" data-act="next" style="background: #0A0A0A; color: #FFFFFF; border: 0; border-radius: 999px; padding: 14px 22px; font-weight: 600; font-size: 16px; min-height: 48px">${esc(v.nextLabel)}</button>`
    + `</div>`;
}

export function playHtml(v: GameView): string {
  return `<div style="display: flex; flex-direction: column; gap: 12px">`
    + `<div style="display: flex; flex-direction: column; gap: 4px">`
    + `<div data-g="rule" class="tv-rule" style="font-weight: 700; line-height: 1.3; color: #0A0A0A">${esc(v.findLine)}</div>`
    + `<div data-g="warn" style="font-weight: 700; font-size: 15px; line-height: 1.35; color: #0A0A0A">${WARN_LINE}</div>`
    + `<div data-g="counter" style="margin-top: 2px; ${SMALL}; color: #6B6B70">${esc(v.counter)}</div>`
    + `</div>`
    + `<div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px">`
    + `<div data-g="meta" style="font-size: 12px; color: #6B6B70">${esc(v.header)}</div>`
    + `<span data-g="score" style="background: #0A0A0A; color: #FFFFFF; border-radius: 999px; padding: 4px 10px; font-size: 11px; letter-spacing: 0.08em; font-weight: 600">SCORE ${v.score}</span>`
    + `</div>`
    + `<div data-g="dots" style="display: flex; gap: 6px" aria-hidden="true">${v.roundDots.map((d) => `<div style="${d}"></div>`).join('')}</div>`
    + `<div data-g="msgs" style="display: flex; flex-direction: column; gap: 8px">${v.msgs.map(msgButton).join('')}</div>`
    + `<div data-g="result" aria-live="polite" style="min-height: 24px">${resultHtml(v)}</div>`
    + `</div>`;
}

export function endHtml(v: GameView): string {
  const ghost = 'display: inline-flex; align-items: center; background: transparent; color: #0A0A0A; border: 1px solid #CFCFCF; border-radius: 999px; padding: 15px 22px; font-weight: 500; font-size: 17px; min-height: 48px; text-decoration: none';
  return `<div class="tv-pop" style="display: flex; flex-direction: column; gap: 18px; align-items: center; text-align: center; padding: 8px 0">`
    + `<div style="${SMALL}; color: #6B6B70">YOUR SCORE · ${esc(v.industryUpper)}</div>`
    + `<div style="font-size: clamp(72px, 14vw, 120px); line-height: 1; font-weight: 600; letter-spacing: -0.04em; color: #0A0A0A">${v.score}/${v.maxScore}</div>`
    + `<div style="display: flex; gap: 4px; width: 100%; max-width: 480px" aria-hidden="true">${v.scoreDots.map((d) => `<div style="${d}"></div>`).join('')}</div>`
    + `<div style="font-size: clamp(26px, 3.4vw, 34px); font-weight: 600; letter-spacing: -0.03em">${esc(v.rank)}</div>`
    + `<p style="margin: 0; font-size: 17px; line-height: 1.6; color: #5A5A5F; max-width: 520px">${esc(v.rankLine)}</p>`
    + `<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center">`
    + `<a class="tv-cta" data-cta href="/request-access" style="background: #0A0A0A; color: #FFFFFF; text-decoration: none; font-weight: 600; font-size: 17px; padding: 16px 26px; border-radius: 999px">Let Tovira catch them for you</a>`
    + `<button class="tv-btn" type="button" data-act="replay" style="${ghost}">Play again</button>`
    + `<a class="tv-btn" data-act="switch" href="/game" style="${ghost}">Try another industry</a>`
    + `</div>`
    + `</div>`;
}

/** The card's whole content for a state (each game page prerenders its first state with this). */
export const cardHtml = (s: GameState): string => { const v = view(s); return v.phase === 'pick' ? pickHtml(v) : v.phase === 'end' ? endHtml(v) : playHtml(v); };

/** [P76 · owner] The hero stacks the game under the copy below 900px (index.html's .tv-hero rule says the same). */
export const STACKED_QUERY = '(max-width: 899px)';
/**
 * [P76 · owner] On mobile (the game stacked), when a new chat or a new game starts and the card's top isn't fully on
 * screen (hidden under the sticky header, above it, or below the screen), scroll so the card's top sits just below the
 * header: smooth, or instant with reduced motion. Desktop never scrolls (the game is beside the copy). True if it scrolled.
 */
export function bringCardIntoView(card: HTMLElement, win: Window = window): boolean {
  if (!cardTopHidden(card, win)) return false;
  scrollToCardTop(card, win);
  return true;
}
/** Is the game stacked (mobile) with the card's top not fully on screen (under the header, above it, or below the screen)? */
export function cardTopHidden(card: HTMLElement, win: Window = window): boolean {
  if (!win.matchMedia?.(STACKED_QUERY).matches) return false;
  const top = card.getBoundingClientRect().top;
  return !(top >= headerBottom(win) && top < win.innerHeight);
}
function scrollToCardTop(card: HTMLElement, win: Window): void {
  const target = (): number => win.scrollY + card.getBoundingClientRect().top - headerBottom(win) - 12;
  if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) win.scrollTo({ top: target(), behavior: 'instant' });
  else smoothScrollTo(win, target);
}
/**
 * [P76] A smooth scroll run frame by frame (ease-out, SMOOTH_MS). The browser's own smooth scroll is cancelled by the 1px
 * adjustment it makes after the card's content is swapped, which left the card where it was; this one isn't. The target
 * is measured again on every frame, so a late layout shift above the card can't leave it a few pixels off. It stops as
 * soon as the page is scrolled by anything else (the visitor's finger), so it never fights them.
 */
export const SMOOTH_MS = 420;
function smoothScrollTo(win: Window, target: () => number): void {
  const from = win.scrollY;
  let start = -1;
  let last = from;
  const step = (now: number): void => {
    if (start < 0) start = now;
    if (Math.abs(win.scrollY - last) > 2) return; // scrolled by someone else: stop here
    const k = Math.min(1, (now - start) / SMOOTH_MS);
    last = from + (target() - from) * (1 - Math.pow(1 - k, 3));
    win.scrollTo({ top: last, behavior: 'instant' });
    if (k < 1) win.requestAnimationFrame(step);
  };
  win.requestAnimationFrame(step);
}
const headerBottom = (win: Window): number => win.document.querySelector('body > header')?.getBoundingClientRect().bottom ?? 0;

/**
 * Mount the game on its card. Within a chat it patches in place (so a tag already shown doesn't pop again, as in the
 * design); a new screen or a new chat re-renders the card. Keyboard focus follows the play: after a tap, to the next
 * message still open, or to Next when the chat is over; a new screen focuses its first control.
 */
export function mountGame(card: HTMLElement, onChange?: (s: GameState, prev: GameState) => void, first: GameState = initialState()): { state: () => GameState } {
  // [P89 · owner, Prompt 86] An industry page starts in that industry's first chat (prerendered); /game starts on the pick.
  let s = first;
  const set = (nextState: GameState, keyboard: boolean, from = -1): void => {
    const prev = s;
    if (nextState === prev) return;
    s = nextState;
    const v = view(s);
    const structural = prev.phase !== s.phase || prev.round !== s.round || prev.gi !== s.gi || (prev.phase === 'end' && s.phase === 'play');
    if (structural || !card.querySelector('[data-g="msgs"]')) card.innerHTML = cardHtml(s);
    else patch(card, v);
    onChange?.(s, prev);
    if (!keyboard) return;
    const open = [...card.querySelectorAll<HTMLElement>('.tv-msg:not([disabled])')];
    const target = v.phase === 'end' ? card.querySelector<HTMLElement>('[data-act="replay"]')
      : v.phase === 'pick' ? open[0]
      : v.done ? card.querySelector<HTMLElement>('[data-act="next"]')
      : from >= 0 ? (open.find((b) => Number(b.dataset.i) > from) ?? open[0])
      : open[0];
    target?.focus({ preventScroll: true });
  };
  card.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i], [data-act]');
    if (!el || !card.contains(el)) return;
    const keyboard = e.detail === 0;
    if (el.dataset.i !== undefined) { const i = Number(el.dataset.i); set(tap(s, i), keyboard, i); }
    else if (el.dataset.act === 'switch' && el.tagName === 'A') {
      // [P89] "Try another industry" is a link to /game: count the switch, let the browser follow the link
      onChange?.(switchIndustry(s), s);
    }
    else if (el.dataset.act === 'start' || el.dataset.act === 'next' || el.dataset.act === 'replay' || el.dataset.act === 'switch') {
      // [P76] on mobile, the new chat or screen starts at the card's top. Decided before the card re-renders: the browser's
      // scroll anchoring can move the page while the card's content is swapped. [P78 · owner] Picking an industry too, so
      // the first chat's rules are on screen.
      const hidden = cardTopHidden(card);
      const act = el.dataset.act;
      set(act === 'start' ? start(s, Number(el.dataset.gi)) : act === 'next' ? next(s) : act === 'replay' ? replay(s) : switchIndustry(s), keyboard);
      if (hidden) scrollToCardTop(card, window);
    }
  });
  return { state: () => s };
}

function patch(card: HTMLElement, v: GameView): void {
  const q = (k: string): HTMLElement => card.querySelector<HTMLElement>(`[data-g="${k}"]`)!;
  q('score').textContent = `SCORE ${v.score}`;
  q('counter').textContent = v.counter;
  ([...q('dots').children] as HTMLElement[]).forEach((d, i) => d.setAttribute('style', v.roundDots[i]!));
  const buttons = [...q('msgs').querySelectorAll<HTMLButtonElement>('.tv-msg')];
  v.msgs.forEach((m, i) => {
    const b = buttons[i]!;
    b.className = 'tv-msg' + (m.anim ? ' ' + m.anim : '');
    b.disabled = m.disabled;
    b.setAttribute('aria-pressed', m.pressed);
    b.setAttribute('style', m.style);
    const inner = msgInner(m);
    if (b.dataset.inner !== inner) { b.innerHTML = inner; b.dataset.inner = inner; }
  });
  const result = q('result');
  const html = resultHtml(v);
  if (result.dataset.html !== html) { result.innerHTML = html; result.dataset.html = html; }
}
