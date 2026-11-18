/**
 * [P71 · owner] "Would you have caught it?": the pick-your-industry landing game, ported from renderVals() in the
 * approved design (plan/tovira-landing-reference.dc.html). Pick an industry, play its 5 chats. A wrong tap ends the chat
 * and reveals every missed detail; finding every detail ends it too. Score = details caught, out of the industry's total.
 * [P73 · owner] 5 messages per chat, 1 to 3 details; a wrong tap says "Not a buying signal" with its "Why not" reason,
 * the other traps "Not a signal"; HOW IT WORKS in 5 steps; a smaller card (Blocks A and C of the design, word for word).
 * Pure state logic plus HTML-string views, so the same code renders the prerendered pick screen in index.html (pinned
 * by a test) and every state after it in the browser. No libraries.
 */
import { ACCENT, GAMES, type Msg } from './landing-data.js';

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
  msgs: MsgView[]; done: boolean; roundLine: string; roundSub: string; roundDots: string[]; scoreDots: string[];
  score: number; maxScore: number; nextLabel: string; rank: string; rankLine: string;
}

const BASE = 'display:block;width:100%;min-height:46px;padding:10px 14px;border-radius:14px 14px 14px 4px;';
const MONO = 'display:inline-block;margin-top:6px;font-family:"JetBrains Mono","JetBrains Mono Fallback",monospace;font-size:12px;letter-spacing:.06em;';
const MSG_STYLES: Record<MsgState, string> = {
  idle: BASE + 'background:#2A2521;color:#F2EDE4;border:1px solid #332D28',
  hit: BASE + 'background:rgba(232,100,58,.16);color:#FFD9C9;border:1px solid ' + ACCENT + ';box-shadow:0 0 28px rgba(232,100,58,.25)',
  wrong: BASE + 'background:#1A1714;color:#8A8076;border:1px solid #5A2A1E',
  missed: BASE + 'background:#2A2521;color:#F2EDE4;border:1px dashed ' + ACCENT,
  chatter: BASE + 'background:#1A1714;color:#6F675E;border:1px solid #2A2521',
};
const TAG_STYLES: Record<MsgState, string> = {
  idle: '',
  hit: MONO + 'background:' + ACCENT + ';color:#171412;border-radius:999px;padding:4px 10px;font-weight:600',
  wrong: MONO + 'color:#E8643A',
  missed: MONO + 'color:' + ACCENT + ';font-weight:600',
  chatter: MONO + 'color:#6F675E',
};
const DOT = 'flex:1 1 0;min-width:0;height:6px;border-radius:999px;background:';

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
  const roundDots = [0, 1, 2, 3, 4].map((i) => DOT + (i < s.round || (i === s.round && done) ? ACCENT : i === s.round ? '#7D736A' : '#3A332D'));
  const scoreDots: string[] = [];
  for (let i = 0; i < maxScore; i++) scoreDots.push(DOT + (i < score ? ACCENT : '#3A332D'));
  return {
    phase: s.phase, industries: GAMES.map((g) => g.label), industryLabel: game.label, industryUpper: game.label.toUpperCase(),
    header: game.label + ' client · chat ' + (s.round + 1) + ' of 5', roundNo: s.round + 1,
    msgs, done, roundLine, roundSub, roundDots, scoreDots, score, maxScore, nextLabel: s.round >= 4 ? 'See your score' : 'Next chat →', ...rankFor(score, maxScore),
  };
}

// ---- HTML views (markup and inline styles as drawn in the reference) ----

export const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONO_FAMILY = "'JetBrains Mono', 'JetBrains Mono Fallback', monospace";
const SERIF_FAMILY = "Fraunces, 'Fraunces Fallback', Georgia, serif";

export function pickHtml(v: GameView): string {
  const b = 'style="color: #F2EDE4"';
  return `<div style="display: flex; flex-direction: column; gap: 14px">`
    + `<p style="margin: 0; font-size: 15px; line-height: 1.5; color: #F2EDE4">A quick test of how well you read client chats. Clients drop details that win deals, usually between the small talk. Most reps scroll right past them.</p>`
    + `<div style="background: #171412; border: 1px solid #332D28; border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px">`
    + `<div style="font-family: ${MONO_FAMILY}; font-size: 11px; letter-spacing: 0.14em; color: #A79E92">HOW IT WORKS</div>`
    + `<ol style="margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; line-height: 1.45; color: #CFC6BA">`
    + `<li>Choose your industry. You get <strong ${b}>5 client chats</strong>, each with <strong ${b}>5 messages</strong>.</li>`
    + `<li>Tap every message with a detail that would help you close: something specific to this client, like what they love, their budget, a deadline, a worry or who else has a say.</li>`
    + `<li>Skip the rest. Polite replies, scheduling and things every client says don't count, however good they sound.</li>`
    + `<li><strong ${b}>Every chat has at least one useful detail, and some have up to three.</strong> You won't know how many.</li>`
    + `<li><strong ${b}>One wrong tap ends that chat.</strong> We then show every detail you missed, and why each one matters.</li>`
    + `</ol>`
    + `<div style="font-size: 13px; color: #A79E92">One point per detail caught. Your score shows at the end.</div>`
    + `</div>`
    + `<div style="font-family: ${MONO_FAMILY}; font-size: 11px; letter-spacing: 0.14em; color: #A79E92">CHOOSE YOUR INDUSTRY</div>`
    + `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px">`
    + v.industries.map((label, i) => `<button class="tv-btn tv-msg" type="button" data-act="start" data-gi="${i}" style="background: #2A2521; color: #F2EDE4; border: 1px solid #3A332D; border-radius: 14px; padding: 12px 14px; min-height: 48px; font-size: 15px; font-weight: 600; text-align: left">${esc(label)}</button>`).join('')
    + `</div>`
    + `</div>`;
}

export function msgInner(m: MsgView): string {
  return `<span style="display: block; font-size: 15px; line-height: 1.4">${esc(m.t)}</span>`
    + (m.hasTag ? `<span class="tv-pop" style="${esc(m.tagStyle)}">${esc(m.tag)}</span>` : '')
    + (m.hasWhy ? `<span class="tv-pop" style="display: block; margin-top: 6px; font-size: 13px; line-height: 1.5; color: #CFC6BA"><span style="font-weight: 600; color: #F2EDE4">${esc(m.whyLabel)}</span>${esc(m.why)}</span>` : '');
}

export function msgButton(m: MsgView, i: number): string {
  return `<button class="tv-msg${m.anim ? ' ' + m.anim : ''}" type="button" data-i="${i}"${m.disabled ? ' disabled' : ''} aria-pressed="${m.pressed}" style="${esc(m.style)}">${msgInner(m)}</button>`;
}

export function resultHtml(v: GameView): string {
  if (!v.done) return '';
  return `<div class="tv-pop" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; border-top: 1px solid #332D28; padding-top: 18px">`
    + `<div style="display: flex; flex-direction: column; gap: 4px; flex: 1 1 240px; min-width: 0"><div style="font-weight: 600; font-size: 17px">${esc(v.roundLine)}</div><div style="font-size: 14px; color: #A79E92">${esc(v.roundSub)}</div></div>`
    + `<button class="tv-btn" type="button" data-act="next" style="background: #F2EDE4; color: #171412; border: 0; border-radius: 999px; padding: 14px 22px; font-weight: 600; font-size: 16px; min-height: 48px">${esc(v.nextLabel)}</button>`
    + `</div>`;
}

export function playHtml(v: GameView): string {
  return `<div style="display: flex; flex-direction: column; gap: 12px">`
    + `<div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px">`
    + `<div style="display: flex; flex-direction: column; gap: 2px"><div style="font-weight: 600; font-size: 15px">${esc(v.header)}</div><div style="font-size: 12px; color: #A79E92">Tap every useful detail. At least one, maybe more.</div></div>`
    + `<span data-g="score" style="background: ${ACCENT}; color: #171412; border-radius: 999px; padding: 7px 12px; font-family: ${MONO_FAMILY}; font-size: 12px; letter-spacing: 0.08em; font-weight: 600">SCORE ${v.score}</span>`
    + `</div>`
    + `<div data-g="dots" style="display: flex; gap: 6px" aria-hidden="true">${v.roundDots.map((d) => `<div style="${d}"></div>`).join('')}</div>`
    + `<div data-g="msgs" style="display: flex; flex-direction: column; gap: 8px">${v.msgs.map(msgButton).join('')}</div>`
    + `<div data-g="result" aria-live="polite" style="min-height: 24px">${resultHtml(v)}</div>`
    + `</div>`;
}

export function endHtml(v: GameView): string {
  const ghost = 'background: transparent; color: #F2EDE4; border: 1px solid #4A423B; border-radius: 999px; padding: 15px 22px; font-weight: 500; font-size: 17px; min-height: 48px';
  return `<div class="tv-pop" style="display: flex; flex-direction: column; gap: 18px; align-items: center; text-align: center; padding: 8px 0">`
    + `<div style="font-family: ${MONO_FAMILY}; font-size: 12px; letter-spacing: 0.16em; color: #A79E92">YOUR SCORE · ${esc(v.industryUpper)}</div>`
    + `<div style="font-family: ${SERIF_FAMILY}; font-size: clamp(72px, 14vw, 120px); line-height: 1; font-weight: 600; color: ${ACCENT}">${v.score}/${v.maxScore}</div>`
    + `<div style="display: flex; gap: 4px; width: 100%; max-width: 480px" aria-hidden="true">${v.scoreDots.map((d) => `<div style="${d}"></div>`).join('')}</div>`
    + `<div style="font-family: ${SERIF_FAMILY}; font-size: clamp(26px, 3.4vw, 34px); font-weight: 600">${esc(v.rank)}</div>`
    + `<p style="margin: 0; font-size: 17px; line-height: 1.6; color: #CFC6BA; max-width: 520px">${esc(v.rankLine)}</p>`
    + `<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center">`
    + `<a class="tv-cta" data-cta href="/request-access" style="background: ${ACCENT}; color: #171412; text-decoration: none; font-weight: 600; font-size: 17px; padding: 16px 26px; border-radius: 999px">Let Tovira catch them for you</a>`
    + `<button class="tv-btn" type="button" data-act="replay" style="${ghost}">Play again</button>`
    + `<button class="tv-btn" type="button" data-act="switch" style="${ghost}">Try another industry</button>`
    + `</div>`
    + `</div>`;
}

/** The card's whole content for a state (the prerendered first state in index.html is this, for initialState()). */
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
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  win.scrollTo({ top: win.scrollY + card.getBoundingClientRect().top - headerBottom(win) - 12, behavior: reduced ? 'instant' : 'smooth' });
}
const headerBottom = (win: Window): number => win.document.querySelector('body > header')?.getBoundingClientRect().bottom ?? 0;

/**
 * Mount the game on its card. Within a chat it patches in place (so a tag already shown doesn't pop again, as in the
 * design); a new screen or a new chat re-renders the card. Keyboard focus follows the play: after a tap, to the next
 * message still open, or to Next when the chat is over; a new screen focuses its first control.
 */
export function mountGame(card: HTMLElement, onChange?: (s: GameState, prev: GameState) => void): { state: () => GameState } {
  let s = initialState();
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
    else if (el.dataset.act === 'start') set(start(s, Number(el.dataset.gi)), keyboard);
    else if (el.dataset.act === 'next' || el.dataset.act === 'replay' || el.dataset.act === 'switch') {
      // [P76] on mobile, the new chat or screen starts at the card's top. Decided before the card re-renders: the browser's
      // scroll anchoring can move the page while the card's content is swapped.
      const hidden = cardTopHidden(card);
      set(el.dataset.act === 'next' ? next(s) : el.dataset.act === 'replay' ? replay(s) : switchIndustry(s), keyboard);
      if (hidden) scrollToCardTop(card, window);
    }
  });
  return { state: () => s };
}

function patch(card: HTMLElement, v: GameView): void {
  const q = (k: string): HTMLElement => card.querySelector<HTMLElement>(`[data-g="${k}"]`)!;
  q('score').textContent = `SCORE ${v.score}`;
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
