/**
 * [P89 · owner, Prompt 86] Is the scene working? Cookieless counts with the P63/P71-T rules (no cookie, no id, nothing
 * typed), sent to the same /api/game-event beacon as the game and shown in Admin → Funnel: which scene beat (1 to 5) a
 * visit reached, which Start free was tapped (the beat or section it sits in, from its data-place), and the game banner.
 * Every event carries the page's route. Best-effort: never throws, never delays the page.
 */
import { sendGame, type Send } from './game-track.js';

export const ROUTES = ['/', '/game', '/game/property', '/game/insurance', '/game/wealth', '/game/b2b', '/game/luxury', '/game/recruitment'] as const;
export type Route = (typeof ROUTES)[number];
export const PLACES = ['header', 'beat1', 'beat5', 'pricing', 'closing', 'game_close'] as const;

/** The page's route as counted: '/game/property/index.html' (the redirect while routing waits) counts as '/game/property'. */
export function routeOf(pathname: string): Route | null {
  const p = pathname.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/';
  return (ROUTES as readonly string[]).includes(p) ? (p as Route) : null;
}

/** Count Start free taps (by data-place) and game banner taps anywhere in `root`. */
export function trackClicks(root: Document | HTMLElement, route: Route, send: Send = sendGame): void {
  root.addEventListener('click', (e) => {
    try {
      const a = (e.target as HTMLElement).closest?.('a');
      if (!a) return;
      const place = a.getAttribute('data-place');
      if (a.hasAttribute('data-cta') && place && (PLACES as readonly string[]).includes(place)) send({ event: 'start_click', place, route });
      else if (a.hasAttribute('data-banner')) send({ event: 'game_banner', route });
    } catch { /* never in the way */ }
  });
}

/** A scene beat was reached (once per beat per page view). */
export const beatSink = (route: Route, send: Send = sendGame) => (beat: number): void => send({ event: 'scene_beat', beat, route });
