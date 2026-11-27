/**
 * [P71-T · owner] The landing game's cookieless counts, with the P63 visit rules: no cookie, no id, nothing typed. Each
 * action sends one beacon with only its event and the industry, chat number and counts, a wrong-tap flag, or a score
 * bucket. A game CTA tap leaves a sessionStorage flag (gone when the tab closes) so a request form submitted in the same
 * visit counts once as a game sign-up. Best-effort: never throws, never delays the page.
 */
import { GAMES } from './landing-data.js';
import { isDone, type GameState } from './game.js';

export type GameBeacon = Record<string, string | number | boolean>;
export type Send = (body: GameBeacon) => void;
export const GAME_CTA_KEY = 'tovira.gameCta';
const INDUSTRIES = GAMES.map((g) => g.label);
const BUCKETS = ['0-3', '4-6', '7-9', '10-11', '12'];

export const bucketOf = (score: number): string => (score >= 12 ? '12' : score >= 10 ? '10-11' : score >= 7 ? '7-9' : score >= 4 ? '4-6' : '0-3');

export const sendGame: Send = (body) => {
  try {
    const json = JSON.stringify(body);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') navigator.sendBeacon('/api/game-event', new Blob([json], { type: 'text/plain' }));
    else void fetch('/api/game-event', { method: 'POST', body: json, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(() => undefined);
  } catch { /* never in the way */ }
};

const chatOf = (s: GameState) => GAMES[s.gi]!.chats[s.round]!;
const scoreOf = (s: GameState): number => s.results.reduce((a, r) => a + r, 0);

/** Watch the game: game_view the first time its box is on screen, and an event for each action (via mountGame's onChange). */
export function trackGame(box: HTMLElement, card: HTMLElement, sendRaw: Send = sendGame, route?: string): { onChange: (s: GameState, prev: GameState) => void } {
  // [P89 · owner, Prompt 86] every event carries the game page it came from ('/game' or '/game/<industry>')
  const send: Send = route ? (body) => sendRaw({ ...body, route }) : sendRaw;
  try {
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); send({ event: 'game_view' }); }
      }, { threshold: 0.3 });
      io.observe(box);
    }
  } catch { /* never in the way */ }
  let last: GameState | null = null;
  card.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[data-cta]');
    if (!a || !last || last.phase !== 'end') return;
    const flag = { industry: GAMES[last.gi]!.label, bucket: bucketOf(scoreOf(last)) };
    send({ event: 'game_cta', ...flag });
    try { sessionStorage.setItem(GAME_CTA_KEY, JSON.stringify(route ? { ...flag, route } : flag)); } catch { /* private mode: no sign-up link */ }
  });
  const onChange = (s: GameState, prev: GameState): void => {
    last = s;
    const industry = s.gi >= 0 ? GAMES[s.gi]!.label : '';
    if (prev.phase === 'pick' && s.phase === 'play') send({ event: 'game_start', industry });
    else if (prev.phase === 'end' && s.phase === 'play') send({ event: 'game_replay', industry });
    else if (prev.phase === 'end' && s.phase === 'pick') send({ event: 'game_switch' });
    else if (s.phase === 'end' && prev.phase === 'play') send({ event: 'game_done', industry, bucket: bucketOf(scoreOf(s)) });
    else if (s.phase === 'play' && prev.phase === 'play' && s.round === prev.round && isDone(s) && !isDone(prev)) {
      const chat = chatOf(s);
      send({ event: 'chat_done', industry, chat: s.round + 1, caught: s.tapped.filter((i) => chat[i]!.sig).length, details: chat.filter((m) => m.sig).length, wrong: s.tapped.some((i) => !chat[i]!.sig) });
    }
  };
  return { onChange };
}

/** A request form was submitted: if a game CTA was tapped in this tab, count one game sign-up and clear the flag. */
export function gameSignedUp(send: Send = sendGame): void {
  try {
    const raw = sessionStorage.getItem(GAME_CTA_KEY);
    if (!raw) return;
    sessionStorage.removeItem(GAME_CTA_KEY);
    const f = JSON.parse(raw) as { industry?: unknown; bucket?: unknown; route?: unknown };
    if (INDUSTRIES.includes(f.industry as string) && BUCKETS.includes(f.bucket as string)) send({ event: 'game_signup', industry: f.industry as string, bucket: f.bucket as string, ...(typeof f.route === 'string' ? { route: f.route } : {}) });
  } catch { /* never in the way */ }
}
