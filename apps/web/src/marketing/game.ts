/**
 * [P70 · owner] "Would you have caught it?": the landing game, ported from renderVals() in the approved design
 * (plan/tovira-landing-reference.dc.html). Pure state logic plus HTML-string views, so the same code renders the
 * prerendered first state in index.html (pinned by a test) and every state after it in the browser. No libraries.
 */
import { ACCENT, ROUNDS, type Round } from './landing-data.js';

export interface GameState { round: number; tapped: number[]; history: number[]; historyPts: number[]; ended: boolean; shakeAt: number }

export const initialState = (): GameState => ({ round: 0, tapped: [], history: [], historyPts: [], ended: false, shakeAt: -1 });

export const TOTAL_SIGS = ROUNDS.reduce((a, r) => a + r.msgs.filter((m) => m.sig).length, 0);

const roundOf = (s: GameState): Round => ROUNDS[Math.min(s.round, ROUNDS.length - 1)]!;
const sigsIn = (r: Round): number => r.msgs.filter((m) => m.sig).length;
/** Taps per chat: one per detail, plus that chat's spare taps. */
export const tapLimit = (r: Round): number => sigsIn(r) + r.spare;
const foundIn = (s: GameState, r: Round): number => s.tapped.filter((i) => r.msgs[i]!.sig).length;
/** The round is over when the taps run out or every detail is found. */
export const roundOver = (s: GameState): boolean => { const r = roundOf(s); return !s.ended && (s.tapped.length >= tapLimit(r) || foundIn(s, r) === sigsIn(r)); };

export function tap(s: GameState, i: number): GameState {
  const r = roundOf(s);
  if (s.ended || roundOver(s) || s.tapped.includes(i) || !r.msgs[i]) return s;
  return { ...s, tapped: s.tapped.concat([i]), shakeAt: r.msgs[i]!.sig ? -1 : i };
}

export function next(s: GameState): GameState {
  if (!roundOver(s)) return s;
  const r = roundOf(s);
  const found = foundIn(s, r);
  const history = s.history.concat([found]);
  const historyPts = s.historyPts.concat([found * r.pts]);
  if (s.round >= ROUNDS.length - 1) return { ...s, history, historyPts, ended: true, tapped: [], shakeAt: -1 };
  return { ...s, history, historyPts, round: s.round + 1, tapped: [], shakeAt: -1 };
}

export const replay = (): GameState => initialState();

export function rankFor(total: number): { rank: string; rankLine: string } {
  if (total >= TOTAL_SIGS) return { rank: 'Eagle eye.', rankLine: 'You caught all ' + TOTAL_SIGS + '. Now do it across 200 chats a week, before every meeting, without getting tired. Tovira does.' };
  if (total >= 9) return { rank: 'Sharp.', rankLine: 'You missed ' + (TOTAL_SIGS - total) + ', and the hard ones are the ones that win deals. Tovira caught all ' + TOTAL_SIGS + '.' };
  return { rank: 'Like most busy reps.', rankLine: 'You caught ' + total + ' of ' + TOTAL_SIGS + ', reading carefully, in five short chats. Real chats are longer. Tovira caught all ' + TOTAL_SIGS + ', and it never gets tired.' };
}

export type MsgState = 'idle' | 'hit' | 'miss' | 'missed';
export interface MsgView { t: string; st: MsgState; style: string; tag: string; tagStyle: string; hasTag: boolean; why: string; hasWhy: boolean; anim: string; pressed: 'true' | 'false'; disabled: boolean }
export interface GameView {
  playing: boolean; ended: boolean; chat: Round; roundNo: number; level: string; tapsLeft: number; points: number; total: number;
  msgs: MsgView[]; dots: string[]; over: boolean; sigCount: number; found: number; roundLine: string; nextLabel: string; rank: string; rankLine: string;
}

const BASE = 'display:block;width:100%;min-height:52px;padding:12px 16px;border-radius:16px 16px 16px 4px;';
const MONO = 'display:inline-block;margin-top:8px;font-family:"JetBrains Mono","JetBrains Mono Fallback",monospace;font-size:12px;letter-spacing:.06em;';
const MSG_STYLES: Record<MsgState, string> = {
  idle: BASE + 'background:#2A2521;color:#F2EDE4;border:1px solid #332D28',
  hit: BASE + 'background:rgba(232,100,58,.16);color:#FFD9C9;border:1px solid ' + ACCENT + ';box-shadow:0 0 28px rgba(232,100,58,.25)',
  miss: BASE + 'background:#1A1714;color:#6F675E;border:1px solid #2A2521',
  missed: BASE + 'background:#2A2521;color:#F2EDE4;border:1px dashed ' + ACCENT,
};
const TAG_STYLES: Record<MsgState, string> = {
  hit: MONO + 'background:' + ACCENT + ';color:#171412;border-radius:999px;padding:4px 10px;font-weight:600',
  miss: MONO + 'color:#6F675E',
  missed: MONO + 'color:' + ACCENT,
  idle: '',
};

export function view(s: GameState): GameView {
  const r = roundOf(s);
  const sigCount = sigsIn(r);
  const limit = tapLimit(r);
  const found = foundIn(s, r);
  const over = roundOver(s);
  const prev = s.history.reduce((a, b) => a + b, 0);
  const prevPts = s.historyPts.reduce((a, b) => a + b, 0);
  const total = prev + (s.ended ? 0 : found);
  const points = prevPts + (s.ended ? 0 : found * r.pts);
  const msgs = r.msgs.map((m, i): MsgView => {
    const tapped = s.tapped.includes(i);
    let st: MsgState = 'idle';
    if (tapped && m.sig) st = 'hit';
    else if (tapped) st = 'miss';
    else if (over && m.sig) st = 'missed';
    const tags: Record<MsgState, string> = { idle: '', hit: '+' + r.pts + ' · ' + m.sig, miss: 'Just chatter. Nothing here helps you close.', missed: 'You missed it: ' + m.sig };
    return {
      t: m.t, st, style: MSG_STYLES[st], tag: tags[st], tagStyle: TAG_STYLES[st], hasTag: st !== 'idle', why: m.why ?? '',
      hasWhy: st === 'hit' || st === 'missed', anim: st === 'miss' && s.shakeAt === i ? 'tv-shake' : '', pressed: tapped ? 'true' : 'false', disabled: tapped || over,
    };
  });
  const dots: string[] = [];
  for (let i = 0; i < TOTAL_SIGS; i++) dots.push('flex:1 1 0;min-width:0;height:6px;border-radius:999px;background:' + (i < total ? ACCENT : '#3A332D') + ';transition:background .3s');
  const last = s.round >= ROUNDS.length - 1;
  const roundLine = found === sigCount ? (sigCount === 2 ? 'You caught both. Nice.' : 'You caught all ' + sigCount + '. Nice.') : 'You caught ' + found + ' of ' + sigCount + '.';
  return {
    playing: !s.ended, ended: s.ended, chat: r, roundNo: s.round + 1, level: r.level, tapsLeft: Math.max(0, limit - s.tapped.length), points, total,
    msgs, dots, over, sigCount, found, roundLine, nextLabel: last ? 'See your score' : 'Next chat →', ...rankFor(total),
  };
}

// ---- HTML views (markup and inline styles as drawn in the reference) ----

export const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function msgInner(m: MsgView): string {
  return `<span style="display: block; font-size: 16px; line-height: 1.45">${esc(m.t)}</span>`
    + (m.hasTag ? `<span class="tv-pop" style="${esc(m.tagStyle)}">${esc(m.tag)}</span>` : '')
    + (m.hasWhy ? `<span class="tv-pop" style="display: block; margin-top: 8px; font-size: 14px; line-height: 1.5; color: #CFC6BA"><span style="font-weight: 600; color: #F2EDE4">Why it counts: </span>${esc(m.why)}</span>` : '');
}

export function msgButton(m: MsgView, i: number): string {
  return `<button class="tv-msg${m.anim ? ' ' + m.anim : ''}" type="button" data-i="${i}"${m.disabled ? ' disabled' : ''} aria-pressed="${m.pressed}" style="${esc(m.style)}">${msgInner(m)}</button>`;
}

const dotsHtml = (v: GameView): string => v.dots.map((d) => `<div style="${d}"></div>`).join('');

export function resultHtml(v: GameView): string {
  if (!v.over) return '';
  return `<div class="tv-pop" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; border-top: 1px solid #332D28; padding-top: 18px">`
    + `<div style="display: flex; flex-direction: column; gap: 4px"><div style="font-weight: 600; font-size: 17px">${esc(v.roundLine)}</div><div style="font-size: 14px; color: #A79E92">Tovira caught ${v.sigCount} of ${v.sigCount}. Every one linked to the message.</div></div>`
    + `<button class="tv-btn" type="button" data-act="next" style="background: #F2EDE4; color: #171412; border: 0; border-radius: 999px; padding: 14px 22px; font-weight: 600; font-size: 16px; min-height: 48px">${esc(v.nextLabel)}</button>`
    + `</div>`;
}

export function playingHtml(v: GameView): string {
  return `<div style="display: flex; flex-direction: column; gap: 18px">`
    + `<div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px">`
    + `<div style="display: flex; align-items: center; gap: 12px">`
    + `<div style="width: 42px; height: 42px; border-radius: 50%; background: #3A332D; display: flex; align-items: center; justify-content: center; font-weight: 600">${esc(v.chat.initials)}</div>`
    + `<div style="display: flex; flex-direction: column; gap: 2px"><div style="font-weight: 600; font-size: 16px">${esc(v.chat.name)}</div><div style="font-size: 12px; color: #A79E92">${esc(v.chat.tag)}</div></div>`
    + `</div>`
    + `<div style="display: flex; gap: 8px; flex-wrap: wrap; font-family: 'JetBrains Mono', 'JetBrains Mono Fallback', monospace; font-size: 12px; letter-spacing: 0.08em">`
    + `<span data-g="round" style="border: 1px solid #3A332D; border-radius: 999px; padding: 7px 12px; color: #CFC6BA">CHAT ${v.roundNo}/5 · ${esc(v.level)}</span>`
    + `<span data-g="taps" style="border: 1px solid #3A332D; border-radius: 999px; padding: 7px 12px; color: #CFC6BA">TAPS LEFT ${v.tapsLeft}</span>`
    + `<span data-g="pts" style="background: ${ACCENT}; color: #171412; border-radius: 999px; padding: 7px 12px; font-weight: 600">${v.points} PTS</span>`
    + `</div>`
    + `</div>`
    + `<div data-g="dots" style="display: flex; gap: 6px" aria-hidden="true">${dotsHtml(v)}</div>`
    + `<div data-g="msgs" style="display: flex; flex-direction: column; gap: 10px">${v.msgs.map(msgButton).join('')}</div>`
    + `<div data-g="result" aria-live="polite" style="min-height: 24px">${resultHtml(v)}</div>`
    + `</div>`;
}

export function endedHtml(v: GameView): string {
  return `<div class="tv-pop" style="display: flex; flex-direction: column; gap: 20px; align-items: center; text-align: center; padding: 12px 0">`
    + `<div style="font-family: 'JetBrains Mono', 'JetBrains Mono Fallback', monospace; font-size: 12px; letter-spacing: 0.16em; color: #A79E92">YOUR SCORE</div>`
    + `<div style="font-family: Fraunces, 'Fraunces Fallback', Georgia, serif; font-size: clamp(72px, 14vw, 120px); line-height: 1; font-weight: 600; color: ${ACCENT}">${v.total}/12</div>`
    + `<div style="font-family: 'JetBrains Mono', 'JetBrains Mono Fallback', monospace; font-size: 13px; letter-spacing: 0.12em; color: #CFC6BA">${v.points} POINTS</div>`
    + `<div style="display: flex; gap: 6px; width: 100%; max-width: 480px" aria-hidden="true">${dotsHtml(v)}</div>`
    + `<div style="font-family: Fraunces, 'Fraunces Fallback', Georgia, serif; font-size: clamp(26px, 3.4vw, 34px); font-weight: 600">${esc(v.rank)}</div>`
    + `<p style="margin: 0; font-size: 17px; line-height: 1.6; color: #CFC6BA; max-width: 520px">${esc(v.rankLine)}</p>`
    + `<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center">`
    + `<a class="tv-cta" data-cta href="/request-access" style="background: ${ACCENT}; color: #171412; text-decoration: none; font-weight: 600; font-size: 17px; padding: 16px 26px; border-radius: 999px">Let Tovira catch them for you</a>`
    + `<button class="tv-btn" type="button" data-act="replay" style="background: transparent; color: #F2EDE4; border: 1px solid #4A423B; border-radius: 999px; padding: 15px 22px; font-weight: 500; font-size: 17px; min-height: 48px">Play again</button>`
    + `</div>`
    + `</div>`;
}

/** The card's whole content for a state (the prerendered first state in index.html is this, for initialState()). */
export const cardHtml = (s: GameState): string => { const v = view(s); return v.ended ? endedHtml(v) : playingHtml(v); };

/**
 * Mount the game on its card. Within a chat it patches in place (so a tag already shown doesn't pop again, as in the
 * design); a new chat, the end screen and Play again re-render the card. Keyboard focus follows the play: after a
 * tap, to the next message still open, or to Next when the chat is over.
 */
export function mountGame(card: HTMLElement, onChange?: (s: GameState, prev: GameState) => void): { state: () => GameState } {
  let s = initialState();
  const set = (nextState: GameState, focus: 'msg' | 'first' | 'none', from = -1): void => {
    const prev = s;
    s = nextState;
    const v = view(s);
    const structural = prev.round !== s.round || prev.ended !== s.ended;
    if (structural || !card.querySelector('[data-g="msgs"]')) card.innerHTML = cardHtml(s);
    else patch(card, v);
    onChange?.(s, prev);
    if (focus === 'none') return;
    const open = [...card.querySelectorAll<HTMLElement>('.tv-msg:not([disabled])')];
    const target = v.ended ? card.querySelector<HTMLElement>('[data-act="replay"]')
      : v.over ? card.querySelector<HTMLElement>('[data-act="next"]')
      : focus === 'msg' ? (open.find((b) => Number(b.dataset.i) > from) ?? open[0])
      : open[0];
    target?.focus({ preventScroll: true });
  };
  card.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i], [data-act]');
    if (!el || !card.contains(el)) return;
    if (el.dataset.i !== undefined) { const i = Number(el.dataset.i); set(tap(s, i), e.detail === 0 ? 'msg' : 'none', i); }
    else if (el.dataset.act === 'next') set(next(s), e.detail === 0 ? 'first' : 'none');
    else if (el.dataset.act === 'replay') set(replay(), e.detail === 0 ? 'first' : 'none');
  });
  return { state: () => s };
}

function patch(card: HTMLElement, v: GameView): void {
  const q = (k: string): HTMLElement | null => card.querySelector<HTMLElement>(`[data-g="${k}"]`);
  q('taps')!.textContent = `TAPS LEFT ${v.tapsLeft}`;
  q('pts')!.textContent = `${v.points} PTS`;
  const dots = [...q('dots')!.children] as HTMLElement[];
  dots.forEach((d, i) => d.setAttribute('style', v.dots[i]!));
  const buttons = [...q('msgs')!.querySelectorAll<HTMLButtonElement>('.tv-msg')];
  v.msgs.forEach((m, i) => {
    const b = buttons[i]!;
    b.className = 'tv-msg' + (m.anim ? ' ' + m.anim : '');
    b.disabled = m.disabled;
    b.setAttribute('aria-pressed', m.pressed);
    b.setAttribute('style', m.style);
    const inner = msgInner(m);
    if (b.dataset.inner !== inner) { b.innerHTML = inner; b.dataset.inner = inner; }
  });
  const result = q('result')!;
  const html = resultHtml(v);
  if (result.dataset.html !== html) { result.innerHTML = html; result.dataset.html = html; }
}
