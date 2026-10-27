/**
 * [P47-5] One-off, idempotent: the Ledger entries that stored history supports, for events before the P47 deploy (new
 * entries come from events after it). Dry run is the default: it lists every entry it WOULD create (the client, both
 * events with their dates, the window) and writes nothing. --apply writes them in one transaction.
 *
 * Only events whose timestamps are reliable:
 *  - Won after a suggestion: the rep's Won is clients.outcome_changed_at with outcome 'won' and outcome_source 'rep'
 *    (written by the server at the moment the rep set it; an undo restores that same time), and the suggestion is
 *    inventory_shares.shared_at for outcome_set_by 'confirmed_suggestion' (written by the database at the share). The
 *    latest such share within 60 days before the Won is linked; a client already credited is skipped.
 *  - Clients won back: none. Before this deploy nothing recorded a going-quiet alert REACHING the rep (the alert was
 *    only generated: never pushed per client, Today's card not recorded, the in-app "read" flag carries no time), so
 *    no stored history can show one. Inferring it would be a credit Tovira cannot prove.
 *   Dry run:  DATABASE_URL=… npx tsx apps/api/src/scripts/ledger-backfill.ts [--only-user <uuid>]
 *   Apply:    DATABASE_URL=… npx tsx apps/api/src/scripts/ledger-backfill.ts [--only-user <uuid>] --apply
 *   In prod:  scripts/ops/run-backfill.sh --script ledger-backfill [--only-user <uuid>] [--apply]
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { parseBackfillArgs } from './backfill-promise-dates.js';

export const WON_CANDIDATES_SQL = `
SELECT c.user_id, c.id AS client_id, c.name AS client_name, c.outcome_changed_at AS won_at,
       s.id AS share_id, s.shared_at, i.title AS item_title
  FROM clients c
  JOIN LATERAL (
    SELECT s.id, s.shared_at, s.item_id, s.user_id FROM inventory_shares s
     WHERE s.user_id = c.user_id AND s.client_id = c.id AND s.outcome_set_by = 'confirmed_suggestion'
       AND s.shared_at <= c.outcome_changed_at AND c.outcome_changed_at - s.shared_at <= interval '60 days'
     ORDER BY s.shared_at DESC
     LIMIT 1) s ON true
  LEFT JOIN inventory_items i ON i.user_id = s.user_id AND i.id = s.item_id
 WHERE c.outcome = 'won' AND c.outcome_source = 'rep' AND c.outcome_changed_at IS NOT NULL
   AND ($1::uuid IS NULL OR c.user_id = $1::uuid)
   AND NOT EXISTS (SELECT 1 FROM ledger_events e WHERE e.user_id = c.user_id AND e.client_id = c.id AND e.type = 'won_after_suggestion')
 ORDER BY c.outcome_changed_at`;

export const WON_INSERT_SQL = `
INSERT INTO ledger_events (user_id, client_id, type, source_id, dedupe_key, occurred_at)
VALUES ($1, $2, 'won_after_suggestion', $3, $4, to_timestamp($5 / 1000.0))
ON CONFLICT (user_id, dedupe_key) DO NOTHING`;

export interface WonCandidateRow { userId: string; clientId: string; clientName: string; wonAt: Date; shareId: string; sharedAt: Date; itemTitle: string | null }
export interface PlannedWon { userId: string; clientId: string; client: string; item: string; shareId: string; sharedAt: string; wonAt: string; wonAtMs: number; days: number }
export interface LedgerBackfillPlan { won: PlannedWon[]; winBacks: never[] }
interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> }

const day = (d: Date): string => d.toISOString().slice(0, 10);

/** PURE: the entries to create. */
export function planLedgerBackfill(rows: WonCandidateRow[]): LedgerBackfillPlan {
  return {
    won: rows.map((r) => ({
      userId: r.userId, clientId: r.clientId, client: r.clientName, item: r.itemTitle ?? 'an item', shareId: r.shareId,
      sharedAt: day(r.sharedAt), wonAt: day(r.wonAt), wonAtMs: r.wonAt.getTime(), days: Math.round((r.wonAt.getTime() - r.sharedAt.getTime()) / 86_400_000),
    })),
    winBacks: [],
  };
}

export function formatLedgerBackfill(plan: LedgerBackfillPlan, applied: boolean): string[] {
  const n = plan.won.length;
  return [
    `Won after a suggestion: ${n} ${n === 1 ? 'entry' : 'entries'} ${applied ? 'created' : 'would be created'}`,
    ...plan.won.map((w) => `  ${w.client}: Tovira suggested ${w.item} (share ${w.shareId}) on ${w.sharedAt} · the rep set Won on ${w.wonAt} · ${w.days} days apart (window 60)`),
    'Clients won back: 0 (no stored record shows a going-quiet alert reaching the rep before this deploy; new ones are recorded from now on)',
    applied ? 'APPLIED.' : 'DRY RUN: nothing written. Re-run with --apply to create these.',
  ];
}

export async function runLedgerBackfill(db: Queryable, opts: { apply: boolean; onlyUser: string | null }): Promise<{ plan: LedgerBackfillPlan; inserted: number }> {
  await db.query(opts.apply ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    const { rows } = await db.query(WON_CANDIDATES_SQL, [opts.onlyUser]);
    const plan = planLedgerBackfill(rows.map((r) => ({
      userId: String(r.user_id), clientId: String(r.client_id), clientName: String(r.client_name), wonAt: new Date(r.won_at as Date),
      shareId: String(r.share_id), sharedAt: new Date(r.shared_at as Date), itemTitle: (r.item_title as string | null) ?? null,
    })));
    let inserted = 0;
    if (opts.apply) {
      for (const w of plan.won) inserted += (await db.query(WON_INSERT_SQL, [w.userId, w.clientId, w.shareId, `won:${w.clientId}:${w.wonAtMs}`, w.wonAtMs])).rowCount ?? 0;
      await db.query('COMMIT');
    } else {
      await db.query('ROLLBACK');
    }
    return { plan, inserted };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

async function main(): Promise<void> {
  const opts = parseBackfillArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required.'); process.exit(1); }
  const pool = createPool(url);
  try {
    const client = await pool.connect();
    try {
      const { plan } = await runLedgerBackfill(client, opts);
      for (const line of formatLedgerBackfill(plan, opts.apply)) console.log(`[ledger-backfill] ${line}`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[ledger-backfill] failed', e instanceof Error ? e.message : e); process.exit(1); });
}
