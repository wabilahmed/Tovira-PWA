/**
 * [P89 · owner, Prompt 86] The game pages' only script (never app code; marketing-bundle.test.ts walks it too): the
 * referral pass-through on the Start free links, the game on its prerendered card, and its cookieless counts with the
 * page's route. An industry page starts in that industry's first chat, so its arrival counts as "Picked an industry",
 * exactly as picking it on the old landing did. Signed-in reps are not redirected: the game is for sharing.
 */
import './ref.js';
import { initialState, mountGame, start } from './game.js';
import { trackGame } from './game-track.js';
import { routeOf, trackClicks } from './landing-track.js';

function mountGamePage(): void {
  const card = document.querySelector<HTMLElement>('[data-game]');
  const box = document.getElementById('game');
  const route = routeOf(location.pathname) ?? '/game';
  trackClicks(document, route);
  if (!card || !box) return;
  const gi = Number(card.dataset.gi ?? '-1');
  const first = gi >= 0 ? start(initialState(), gi) : initialState();
  const { onChange } = trackGame(box, card, undefined, route);
  mountGame(card, onChange, first);
  if (gi >= 0) onChange(first, initialState()); // game_start for this industry
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountGamePage);
  else mountGamePage();
}
