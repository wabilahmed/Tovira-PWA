import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import { listenForTest } from '../test-support/listen.js';
import { VisitService } from '../services/visits/visits.js';
import { GameEvents, gameFunnel, bucketOf, GAME_INDUSTRIES, type GameEventRow } from '../services/visits/game-events.js';
import { InMemoryVisitStore } from '../adapters/visits/in-memory-visit-store.js';
import { InMemoryFunnelSource } from '../adapters/funnel/in-memory-funnel-source.js';

/**
 * [P71-T · owner] Cookieless game counts, the same rules as the P63 visits: no IP, no user id, no names, nothing typed.
 * Events: game_view, game_start (industry), chat_done (industry, chat 1-5, caught, details, wrong tap), game_done
 * (industry, score bucket), game_cta (industry, bucket), game_replay, game_switch, and game_signup (a request form
 * submitted in the same tab after a game CTA tap). Admin → Funnel shows the game funnel for 7 and 30 days, by industry,
 * and the share of chats ended by a wrong tap per chat number.
 */
const DESK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const T0 = Date.parse('2026-11-16T09:00:00Z');
const mk = () => {
  const clock = { t: T0 };
  const store = new InMemoryVisitStore();
  const visits = new VisitService(store, () => clock.t);
  return { store, clock, visits, games: new GameEvents(store, visits, () => clock.t) };
};
const hit = (g: GameEvents, body: Record<string, unknown>, ua = DESK) => g.record(body, { ip: '1.2.3.4', ua });

describe('[P71-T] game events: what is stored', () => {
  it('stores each valid event once, with only the allowed fields (no IP, no user agent, no hash, nothing typed)', async () => {
    const { store, games } = mk();
    expect(await hit(games, { event: 'game_view' })).toBe(true);
    expect(await hit(games, { event: 'game_start', industry: 'Property' })).toBe(true);
    expect(await hit(games, { event: 'chat_done', industry: 'Property', chat: 2, caught: 1, details: 2, wrong: true, name: 'Sara', email: 'x@y.z' })).toBe(true);
    expect(await hit(games, { event: 'game_done', industry: 'Property', bucket: '4-6' })).toBe(true);
    expect(await hit(games, { event: 'game_cta', industry: 'Property', bucket: '4-6' })).toBe(true);
    expect(await hit(games, { event: 'game_replay', industry: 'Property' })).toBe(true);
    expect(await hit(games, { event: 'game_switch' })).toBe(true);
    expect(await hit(games, { event: 'game_signup', industry: 'Property', bucket: '4-6' })).toBe(true);
    expect(store.games).toHaveLength(8);
    for (const r of store.games) expect(Object.keys(r).sort()).toEqual(['bucket', 'caught', 'chat', 'day', 'details', 'event', 'industry', 'wrong']);
    expect(store.games[2]).toEqual({ day: '2026-11-16', event: 'chat_done', industry: 'Property', chat: 2, caught: 1, details: 2, wrong: true, bucket: null });
    expect(store.games[0]).toEqual({ day: '2026-11-16', event: 'game_view', industry: null, chat: null, caught: null, details: null, wrong: null, bucket: null });
    expect(JSON.stringify(store.games)).not.toMatch(/1\.2\.3\.4|Mozilla|Sara|x@y/);
  });
  it('NEGATIVE: unknown events, industries, chat numbers, counts and buckets are refused', async () => {
    const { store, games } = mk();
    for (const b of [
      { event: 'page_view' }, { event: 'game_start', industry: 'Plumbing' }, { event: 'game_start' },
      { event: 'chat_done', industry: 'Wealth', chat: 6, caught: 1, details: 2, wrong: false },
      { event: 'chat_done', industry: 'Wealth', chat: 1, caught: 3, details: 2, wrong: false },
      { event: 'chat_done', industry: 'Wealth', chat: 1, caught: 1, details: 5, wrong: false },
      { event: 'chat_done', industry: 'Wealth', chat: 1, caught: 1, details: 2, wrong: 'yes' },
      { event: 'game_done', industry: 'Wealth', bucket: '5-8' }, { event: 'game_cta', industry: 'Wealth' },
    ]) expect(await hit(games, b), JSON.stringify(b)).toBe(false);
    expect(store.games).toHaveLength(0);
  });
  it('bots and signed-in admins are not counted', async () => {
    const { store, games, visits } = mk();
    expect(await hit(games, { event: 'game_view' }, 'Googlebot/2.1')).toBe(false);
    await visits.markAdmin({ ip: '1.2.3.4', ua: DESK });
    expect(await hit(games, { event: 'game_view' })).toBe(false);
    expect(store.games).toHaveLength(0);
  });
  it('the score buckets', () => {
    expect([0, 3, 4, 6, 7, 9, 10, 11, 12].map(bucketOf)).toEqual(['0-3', '0-3', '4-6', '4-6', '7-9', '7-9', '10-11', '10-11', '12']);
  });
  it('the migration: one owner-plane table, no IP, no hash, no person column; CHECKs pin the events, industries and buckets', () => {
    const sql = readFileSync(new URL('../../migrations/0116_game_events.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS game_events/);
    expect(sql).not.toMatch(/\bip\b|hash|user_id|email|name text|tovira_app/i);
    for (const e of ['game_view', 'game_start', 'chat_done', 'game_done', 'game_cta', 'game_replay', 'game_switch', 'game_signup']) expect(sql).toContain(`'${e}'`);
    for (const i of GAME_INDUSTRIES) expect(sql).toContain(`'${i}'`);
    for (const b of ['0-3', '4-6', '7-9', '10-11', '12']) expect(sql).toContain(`'${b}'`);
  });
});

describe('[P71-T] the game funnel maths', () => {
  const row = (event: GameEventRow['event'], extra: Partial<GameEventRow> = {}, day = '2026-11-16'): GameEventRow =>
    ({ day, event, industry: null, chat: null, caught: null, details: null, wrong: null, bucket: null, ...extra });
  const rows: GameEventRow[] = [
    ...Array.from({ length: 10 }, () => row('game_view')),
    ...Array.from({ length: 6 }, () => row('game_start', { industry: 'Property' })),
    ...Array.from({ length: 2 }, () => row('game_start', { industry: 'Wealth' })),
    ...Array.from({ length: 6 }, (_, i) => row('chat_done', { industry: 'Property', chat: 1, caught: 1, details: 1, wrong: i < 2 })),
    ...Array.from({ length: 4 }, (_, i) => row('chat_done', { industry: 'Property', chat: 5, caught: 2, details: 4, wrong: i < 3 })),
    ...Array.from({ length: 4 }, () => row('game_done', { industry: 'Property', bucket: '7-9' })),
    ...Array.from({ length: 2 }, () => row('game_cta', { industry: 'Property', bucket: '7-9' })),
    row('game_signup', { industry: 'Property', bucket: '7-9' }),
    ...Array.from({ length: 5 }, () => row('game_view', {}, '2026-11-01')), // older than 7 days, inside 30
    row('game_view', {}, '2026-10-01'), // outside both
  ];
  it('counts each step and the % drop from the step before, for 7 and 30 days', () => {
    const f = gameFunnel(rows, '2026-11-16');
    expect(f['7d'].steps.map((s) => [s.key, s.n, s.dropPct])).toEqual([
      ['view', 10, null], ['start', 8, 20], ['chat1', 6, 25], ['chat5', 4, 33], ['end', 4, 0], ['cta', 2, 50], ['signup', 1, 50],
    ]);
    expect(f['30d'].steps[0]!.n).toBe(15);
    expect(f['30d'].steps[1]!.dropPct).toBe(47);
  });
  it('splits by industry (from the start, since a view has no industry yet)', () => {
    const f = gameFunnel(rows, '2026-11-16');
    expect(f['7d'].byIndustry.map((r) => r.industry)).toEqual([...GAME_INDUSTRIES]);
    const p = f['7d'].byIndustry.find((r) => r.industry === 'Property')!;
    expect(p.steps.map((s) => [s.key, s.n])).toEqual([['start', 6], ['chat1', 6], ['chat5', 4], ['end', 4], ['cta', 2], ['signup', 1]]);
    expect(f['7d'].byIndustry.find((r) => r.industry === 'Luxury')!.steps.every((s) => s.n === 0 && (s.dropPct === null || s.dropPct === 0))).toBe(true);
  });
  it('the share of chats ended by a wrong tap, per chat number', () => {
    const w = gameFunnel(rows, '2026-11-16')['7d'].wrongShare;
    expect(w).toEqual([
      { chat: 1, chats: 6, wrong: 2, pct: 33 }, { chat: 2, chats: 0, wrong: 0, pct: null }, { chat: 3, chats: 0, wrong: 0, pct: null },
      { chat: 4, chats: 0, wrong: 0, pct: null }, { chat: 5, chats: 4, wrong: 3, pct: 75 },
    ]);
  });
  it('zero data: every count 0, no division by zero', () => {
    const f = gameFunnel([], '2026-11-16');
    expect(f['7d'].steps.every((s) => s.n === 0)).toBe(true);
    expect(f['7d'].steps.map((s) => s.dropPct)).toEqual([null, null, null, null, null, null, null]);
    expect(f['7d'].wrongShare.every((w) => w.pct === null)).toBe(true);
  });
});

describe('[P71-T] the routes', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });
  const up = async (): Promise<{ base: string; deps: TestDeps }> => {
    const deps = buildInMemoryDeps();
    deps.adminFunnel = { source: new InMemoryFunnelSource() };
    server = createApiServer(deps);
    return { base: await listenForTest(server), deps };
  };

  it('POST /game-event: 204, no body, no cookie, and the event is counted', async () => {
    const { base, deps } = await up();
    const r = await fetch(`${base}/game-event`, { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': DESK }, body: JSON.stringify({ event: 'game_start', industry: 'Luxury' }) });
    expect(r.status).toBe(204);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(await r.text()).toBe('');
    expect(deps.visitStore.games.map((g) => [g.event, g.industry])).toEqual([['game_start', 'Luxury']]);
  });
  it('Admin → Funnel carries the game funnel for 7 and 30 days, even with zero data', async () => {
    const { base, deps } = await up();
    const { cookie } = await signInAdmin(base, deps);
    const r = await fetch(`${base}/admin/funnel?period=30d`, { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = await r.json() as { game?: { '7d': { steps: Array<{ n: number }> }; '30d': unknown } };
    expect(body.game?.['7d'].steps.map((s) => s.n)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(body.game?.['30d']).toBeDefined();
  });
});
