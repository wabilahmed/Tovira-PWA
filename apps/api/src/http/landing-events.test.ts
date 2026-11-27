import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VisitService } from '../services/visits/visits.js';
import { GameEvents, gameFunnel, GAME_ROUTES, START_PLACES, type GameEventRow } from '../services/visits/game-events.js';
import { InMemoryVisitStore } from '../adapters/visits/in-memory-visit-store.js';

/**
 * [P89 · owner, Prompt 86] Does the new landing scene work? Three more cookieless events on the same beacon and table as
 * the game (P71-T rules: no IP, no id, nothing typed): scene_beat (the beat reached, 1 to 5), start_click (which Start
 * free: the beat or section it sits in) and game_banner (the "Would you have caught it?" banner). Every event, the game's
 * too, may carry the page's route (the landing or one of the seven game pages). Admin → Funnel shows them.
 */
const DESK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const T0 = Date.parse('2026-11-27T09:00:00Z');
const mk = () => {
  const store = new InMemoryVisitStore();
  const visits = new VisitService(store, () => T0);
  return { store, games: new GameEvents(store, visits, () => T0) };
};
const hit = (g: GameEvents, body: Record<string, unknown>) => g.record(body, { ip: '1.2.3.4', ua: DESK });
const row = (event: GameEventRow['event'], extra: Partial<GameEventRow> = {}): GameEventRow =>
  ({ day: '2026-11-27', event, industry: null, chat: null, caught: null, details: null, wrong: null, bucket: null, route: null, beat: null, place: null, ...extra });

describe('[P89] landing events: what is stored', () => {
  it('scene_beat, start_click and game_banner are stored with only their fields', async () => {
    const { store, games } = mk();
    expect(await hit(games, { event: 'scene_beat', beat: 3, route: '/', name: 'Sara' })).toBe(true);
    expect(await hit(games, { event: 'start_click', place: 'beat5', route: '/' })).toBe(true);
    expect(await hit(games, { event: 'start_click', place: 'game_close', route: '/game/wealth' })).toBe(true);
    expect(await hit(games, { event: 'game_banner', route: '/' })).toBe(true);
    expect(store.games[0]).toEqual(row('scene_beat', { beat: 3, route: '/' }));
    expect(store.games[1]).toEqual(row('start_click', { place: 'beat5', route: '/' }));
    expect(store.games[2]).toEqual(row('start_click', { place: 'game_close', route: '/game/wealth' }));
    expect(store.games[3]).toEqual(row('game_banner', { route: '/' }));
    expect(JSON.stringify(store.games)).not.toMatch(/Sara|1\.2\.3\.4|Mozilla/);
  });
  it('the game events carry their route; a game event without one is still counted (an old cached page)', async () => {
    const { store, games } = mk();
    expect(await hit(games, { event: 'game_start', industry: 'Wealth', route: '/game/wealth' })).toBe(true);
    expect(await hit(games, { event: 'game_view', route: '/game' })).toBe(true);
    expect(await hit(games, { event: 'game_view' })).toBe(true);
    expect(store.games.map((r) => r.route)).toEqual(['/game/wealth', '/game', null]);
  });
  it('NEGATIVE: a beat outside 1-5, an unknown place or route, or a landing event missing its field is refused', async () => {
    const { store, games } = mk();
    for (const b of [
      { event: 'scene_beat', beat: 0, route: '/' }, { event: 'scene_beat', beat: 6, route: '/' }, { event: 'scene_beat', beat: 2.5, route: '/' },
      { event: 'scene_beat', route: '/' }, { event: 'start_click', place: 'footer', route: '/' }, { event: 'start_click', route: '/' },
      { event: 'game_banner', route: '/game/plumbing' }, { event: 'scene_beat', beat: 1, route: '/admin' },
      { event: 'game_start', industry: 'Wealth', route: 'https://elsewhere.example/' },
    ]) expect(await hit(games, b), JSON.stringify(b)).toBe(false);
    expect(store.games).toHaveLength(0);
  });
  it('the routes are the landing and the seven game pages; the places are the six Start free buttons', () => {
    expect(GAME_ROUTES).toEqual(['/', '/game', '/game/property', '/game/insurance', '/game/wealth', '/game/b2b', '/game/luxury', '/game/recruitment']);
    expect(START_PLACES).toEqual(['header', 'beat1', 'beat5', 'pricing', 'closing', 'game_close']);
  });
  it('the migration adds route, beat and place with CHECKs, and the three events, and nothing that identifies anyone', () => {
    const sql = readFileSync(new URL('../../migrations/0121_landing_events.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
    expect(sql).toMatch(/ALTER TABLE game_events/);
    for (const e of ['scene_beat', 'start_click', 'game_banner', 'game_view', 'game_signup']) expect(sql).toContain(`'${e}'`);
    for (const r of GAME_ROUTES) expect(sql).toContain(`'${r}'`);
    for (const p of START_PLACES) expect(sql).toContain(`'${p}'`);
    expect(sql).toMatch(/beat\s+smallint[^,]*BETWEEN 1 AND 5/i);
    expect(sql).not.toMatch(/\bip\b|hash|user_id|email|tovira_app/i);
  });
});

describe('[P89] the landing funnel', () => {
  it('counts beats reached, Start free taps by place, banner taps, and game starts by page, for 7 and 30 days', () => {
    const rows: GameEventRow[] = [
      ...[1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5].map((beat) => row('scene_beat', { beat, route: '/' })),
      row('start_click', { place: 'beat1', route: '/' }), row('start_click', { place: 'beat1', route: '/' }), row('start_click', { place: 'pricing', route: '/' }),
      row('game_banner', { route: '/' }), row('game_banner', { route: '/' }),
      row('game_start', { industry: 'Wealth', route: '/game/wealth' }), row('game_view', { route: '/game' }), row('game_view', { route: '/game/wealth' }),
    ];
    const w = gameFunnel(rows, '2026-11-27')['7d'];
    expect(w.landing.beats).toEqual([{ beat: 1, n: 4 }, { beat: 2, n: 3 }, { beat: 3, n: 2 }, { beat: 4, n: 1 }, { beat: 5, n: 1 }]);
    expect(w.landing.starts).toEqual([{ place: 'header', n: 0 }, { place: 'beat1', n: 2 }, { place: 'beat5', n: 0 }, { place: 'pricing', n: 1 }, { place: 'closing', n: 0 }, { place: 'game_close', n: 0 }]);
    expect(w.landing.banner).toBe(2);
    expect(w.byRoute.find((r) => r.route === '/game/wealth')).toEqual({ route: '/game/wealth', views: 1, starts: 1 });
    expect(w.byRoute.find((r) => r.route === '/game')).toEqual({ route: '/game', views: 1, starts: 0 });
    // the game steps still count only game events
    expect(w.steps.find((s) => s.key === 'start')!.n).toBe(1);
  });
});
