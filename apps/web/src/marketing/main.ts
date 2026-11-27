/**
 * Marketing entry — the ONLY script the landing page loads. It must never import app code (asserted by
 * marketing-bundle.test.ts): a stranger on the landing page downloads this tiny module, not the React app bundle.
 *
 * Jobs:
 *  1. Referral pass-through (the growth loop): carry ?ref= / utm_* from the landing URL onto every CTA. Progressive
 *     enhancement: the CTAs already work as plain links. See ./ref.ts (auto-runs).
 *  2. Logged-in redirect: a rep who lands on the marketing page but already has a session is sent to the app shell.
 *     It reads a non-secret hint the app writes on auth; the real session cookie stays HttpOnly.
 *  3. [P89 · owner, Prompt 86] The game moved to /game: an old /#game link goes there.
 *  4. The cookieless page view, the scroll scene (./scene.ts) and its counts (./landing-track.ts).
 */
import './ref.js';
import { sendVisit } from './visit.js';
import { mountScene } from './scene.js';
import { beatSink, trackClicks } from './landing-track.js';

const AUTH_HINT = 'tovira.authed';

/** [P89] Where an old in-page link now lives, or null. */
export function movedAnchor(hash: string): string | null {
  return hash === '#game' ? '/game' : null;
}

function redirect(): boolean {
  const moved = movedAnchor(location.hash);
  if (moved) { location.replace(moved + location.search); return true; }
  try {
    if (localStorage.getItem(AUTH_HINT) === '1') { location.replace('/app' + (location.search || '')); return true; }
  } catch {
    /* private mode / no storage: stay on the marketing page */
  }
  return false;
}

const left = typeof location !== 'undefined' && typeof localStorage !== 'undefined' ? redirect() : false;

// [P63-7] the landing page's cookieless page view
if (!left && typeof location !== 'undefined' && (location.pathname === '/' || location.pathname === '/index.html')) sendVisit('landing');

function mountLanding(): void {
  trackClicks(document, '/');
  mountScene(document, window, beatSink('/'));
}
if (!left && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountLanding);
  else mountLanding();
}
