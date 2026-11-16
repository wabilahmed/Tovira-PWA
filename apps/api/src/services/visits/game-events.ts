import { isBot, utcDay, type VisitService } from './visits.js';

/**
 * [P71-T · owner] Cookieless counts for the landing page game, with the P63 visit rules: no IP, no user id, no names,
 * nothing typed, no hash kept. Each action is one row with only the fields its event carries. Bots and signed-in admins
 * (that day's admin mark, checked and not stored) don't count. Owner plane; shown only in Admin → Funnel.
 */
export const GAME_EVENTS = ['game_view', 'game_start', 'chat_done', 'game_done', 'game_cta', 'game_replay', 'game_switch', 'game_signup'] as const;
export type GameEvent = (typeof GAME_EVENTS)[number];
export const GAME_INDUSTRIES = ['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment'] as const;
export type GameIndustry = (typeof GAME_INDUSTRIES)[number];
export const SCORE_BUCKETS = ['0-3', '4-6', '7-9', '10-11', '12'] as const;
export type ScoreBucket = (typeof SCORE_BUCKETS)[number];

export interface GameEventRow {
  day: string; event: GameEvent; industry: GameIndustry | null; chat: number | null; caught: number | null;
  details: number | null; wrong: boolean | null; bucket: ScoreBucket | null;
}
export interface GameEventStore {
  addGame(row: GameEventRow): Promise<void>;
  gamesSince(sinceDay: string): Promise<GameEventRow[]>;
}

export const bucketOf = (score: number): ScoreBucket => (score >= 12 ? '12' : score >= 10 ? '10-11' : score >= 7 ? '7-9' : score >= 4 ? '4-6' : '0-3');

const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const industryOf = (v: unknown): GameIndustry | undefined => (GAME_INDUSTRIES as readonly unknown[]).includes(v) ? (v as GameIndustry) : undefined;
const bucket = (v: unknown): ScoreBucket | undefined => (SCORE_BUCKETS as readonly unknown[]).includes(v) ? (v as ScoreBucket) : undefined;

/** The row for a beacon body, or null if anything the event needs is missing or out of range. Everything else is dropped. */
export function parseGameEvent(body: Record<string, unknown>, day: string): GameEventRow | null {
  const event = body.event as GameEvent;
  if (!(GAME_EVENTS as readonly unknown[]).includes(event)) return null;
  const row: GameEventRow = { day, event, industry: null, chat: null, caught: null, details: null, wrong: null, bucket: null };
  const ind = industryOf(body.industry);
  switch (event) {
    case 'game_view': case 'game_switch': return row;
    case 'game_start': case 'game_replay': return ind ? { ...row, industry: ind } : null;
    case 'chat_done': {
      const chat = int(body.chat, 1, 5); const details = int(body.details, 1, 4); const caught = int(body.caught, 0, 4);
      if (!ind || chat === undefined || details === undefined || caught === undefined || caught > details || typeof body.wrong !== 'boolean') return null;
      return { ...row, industry: ind, chat, caught, details, wrong: body.wrong };
    }
    case 'game_done': case 'game_cta': case 'game_signup': {
      const b = bucket(body.bucket);
      return ind && b ? { ...row, industry: ind, bucket: b } : null;
    }
  }
}

export class GameEvents {
  constructor(private readonly store: GameEventStore, private readonly visits: Pick<VisitService, 'isAdminToday'>, private readonly now: () => number = () => Date.now()) {}

  /** One beacon. Returns whether it was counted. The IP and user agent are used for the bot and admin checks only. */
  async record(body: Record<string, unknown>, from: { ip: string; ua: string }): Promise<boolean> {
    if (isBot(from.ua)) return false;
    const row = parseGameEvent(body, utcDay(this.now()));
    if (!row) return false;
    if (await this.visits.isAdminToday(from)) return false;
    await this.store.addGame(row);
    return true;
  }

  async funnel(): Promise<GameFunnel> {
    const today = utcDay(this.now());
    return gameFunnel(await this.store.gamesSince(utcDay(this.now() - 29 * 86_400_000)), today);
  }
}

export type StepKey = 'view' | 'start' | 'chat1' | 'chat5' | 'end' | 'cta' | 'signup';
export interface FunnelStep { key: StepKey; label: string; n: number; dropPct: number | null }
export interface GameWindow {
  steps: FunnelStep[];
  byIndustry: Array<{ industry: GameIndustry; steps: FunnelStep[] }>;
  wrongShare: Array<{ chat: number; chats: number; wrong: number; pct: number | null }>;
}
export type GameFunnel = Record<'7d' | '30d', GameWindow>;

const STEPS: Array<{ key: StepKey; label: string; is: (r: GameEventRow) => boolean }> = [
  { key: 'view', label: 'Saw the game', is: (r) => r.event === 'game_view' },
  { key: 'start', label: 'Picked an industry', is: (r) => r.event === 'game_start' },
  { key: 'chat1', label: 'Finished chat 1', is: (r) => r.event === 'chat_done' && r.chat === 1 },
  { key: 'chat5', label: 'Finished chat 5', is: (r) => r.event === 'chat_done' && r.chat === 5 },
  { key: 'end', label: 'Saw the end screen', is: (r) => r.event === 'game_done' },
  { key: 'cta', label: 'Tapped the CTA', is: (r) => r.event === 'game_cta' },
  { key: 'signup', label: 'Signed up', is: (r) => r.event === 'game_signup' },
];
const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

function stepsOf(rows: GameEventRow[], from: StepKey = 'view'): FunnelStep[] {
  const steps = STEPS.slice(STEPS.findIndex((s) => s.key === from));
  const counts = steps.map((s) => rows.filter(s.is).length);
  return steps.map((s, i) => ({ key: s.key, label: s.label, n: counts[i]!, dropPct: i === 0 ? null : pct(Math.max(0, counts[i - 1]! - counts[i]!), counts[i - 1]!) }));
}

/** The game funnel for the last 7 and 30 days (including today): each step's count and its % drop from the step before,
 *  split by industry from the start step, and the share of chats a wrong tap ended, per chat number. */
export function gameFunnel(rows: GameEventRow[], today: string): GameFunnel {
  const t = Date.parse(`${today}T00:00:00Z`);
  const window = (days: number): GameWindow => {
    const since = utcDay(t - (days - 1) * 86_400_000);
    const r = rows.filter((x) => x.day >= since && x.day <= today);
    return {
      steps: stepsOf(r),
      byIndustry: GAME_INDUSTRIES.map((industry) => ({ industry, steps: stepsOf(r.filter((x) => x.industry === industry), 'start') })),
      wrongShare: [1, 2, 3, 4, 5].map((chat) => {
        const done = r.filter((x) => x.event === 'chat_done' && x.chat === chat);
        const wrong = done.filter((x) => x.wrong).length;
        return { chat, chats: done.length, wrong, pct: pct(wrong, done.length) };
      }),
    };
  };
  return { '7d': window(7), '30d': window(30) };
}
