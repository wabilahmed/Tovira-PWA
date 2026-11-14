/**
 * Marketing entry — the ONLY script the static landing/legal pages load. It must
 * never import app code (asserted by marketing-bundle.test.ts): a stranger on the
 * landing page downloads this tiny module, not the React app bundle.
 *
 * Two jobs:
 *  1. Referral pass-through (the growth loop): carry ?ref= / utm_* from the
 *     landing URL onto every CTA and the language switch. Progressive enhancement
 *     — the CTAs already work as plain links to /app. See ./ref.ts (auto-runs).
 *  2. Logged-in redirect: a rep who lands on the marketing page but already has a
 *     session is sent to the app shell — marketing is for strangers. It reads a
 *     non-secret hint the app writes on auth; the real session cookie stays
 *     HttpOnly and is still validated by the app.
 */
import './ref.js';
import { sendVisit } from './visit.js';
import { mountGame } from './game.js';
import { mountWorlds } from './worlds.js';

const AUTH_HINT = 'tovira.authed';

function redirectIfAuthed(): void {
  try {
    if (localStorage.getItem(AUTH_HINT) === '1') {
      location.replace('/app' + (location.search || ''));
    }
  } catch {
    /* private mode / no storage — stay on the marketing page */
  }
}

if (typeof location !== 'undefined' && typeof localStorage !== 'undefined') redirectIfAuthed();

// [P63-7] the landing page's cookieless page view
if (typeof location !== 'undefined' && (location.pathname === '/' || location.pathname === '/index.html')) sendVisit('landing');

// [P70 · owner] The only page script beyond the referral pass-through and the visit beacon: the game and the industry
// tabs. Every animation is CSS (index.html); there is no scroll or reveal script.
function mountLanding(): void {
  const card = document.querySelector<HTMLElement>('[data-game]');
  if (card) mountGame(card);
  const tabs = document.querySelector<HTMLElement>('[data-worlds]');
  const panel = document.querySelector<HTMLElement>('[data-world-panel]');
  if (tabs && panel) mountWorlds(tabs, panel);
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountLanding);
  else mountLanding();
}
