import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { loadMigrations, runMigrations } from './migrate.js';
import { appQueries, type FoundQuery } from '../test-support/query-inventory.js';

/**
 * [P86 · index audit, owner 24 Nov] Every query the app runs, EXPLAINed on a seeded Postgres 16, in CI.
 *
 * The audit EXPLAINed all ~400 app queries on 200 reps x 100 clients with 2M chat messages and added the missing
 * indexes (migration 0120). This keeps it fixed. It reads every `.query(...)` from the source (so a NEW query is
 * checked the day it is written), plans it the way prod runs it (a tenant query as tovira_app with RLS and the rep
 * set; an owner-pool query as the owner) with EXPLAIN (GENERIC_PLAN), and fails on:
 *   - a sequential scan of a table that grows with usage;
 *   - a query built at runtime that has no representative SQL below (so it cannot hide from the check);
 *   - a foreign key with no index on its referencing columns (a parent delete would scan the child table).
 * Gated on MIGRATIONS_TEST_DB_URL, which CI's real-Postgres job sets; a laptop `npm test` skips it.
 */
const ADMIN_URL = process.env.MIGRATIONS_TEST_DB_URL;
const suite = ADMIN_URL ? describe : describe.skip;
const DB = 'tovira_query_plans_test';
const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Tables that grow with reps, clients, messages or traffic. A sequential scan of any of these fails the build. */
const GROWING = [
  'users', 'subscriptions', 'clients', 'notes', 'promises', 'key_dates', 'meetings', 'requirements', 'corrections', 'extraction_logs',
  'ai_message_charge', 'notifications', 'ledger_events', 'client_aliases', 'client_pointers', 'client_deal_values', 'client_outcome_history',
  'client_name_history', 'going_quiet_alerts', 'person_link_questions', 'promise_kept_suggestions', 'images', 'inventory_items',
  'inventory_matches', 'inventory_shares', 'recall_sessions', 'recall_messages', 'recall_daily', 'model_call_events', 'spend_ledger',
  'ai_usage_month', 'ai_reservation', 'transcription_events', 'revenue_events', 'extraction_counters', 'daily_priorities', 'push_budget',
  'email_log', 'sessions', 'push_subscriptions', 'rep_glossary', 'note_move_audit', 'access_requests', 'hot_leads', 'page_views',
  'visit_days', 'visit_excluded', 'game_events', 'admin_audit', 'ops_alerts', 'webhook_events', 'whatsapp_inbound', 'trial_grants',
  'referrals', 'invoice_tax',
];

/** Representative SQL for a query whose text is built at runtime: same table, same WHERE as the code builds. */
const STAND_IN: Record<string, string> = {
  'adapters/admin/pg-admin-store.ts#PgAdminStore.updateUser': 'UPDATE admin_users SET totp_last_step = $2 WHERE id = $1',
  'adapters/billing/pg.ts#PgSubscriptionRepository.update': 'UPDATE subscriptions SET status = $1, updated_at = now() WHERE user_id = $2',
  'adapters/facts/pg-facts-repository.ts#PgFactsRepository.listPromisesByUser': 'SELECT id FROM promises WHERE user_id = $1 AND merged_into IS NULL AND deleted_at IS NULL ORDER BY created_at DESC',
  'adapters/facts/pg-facts-repository.ts#PgFactsRepository.updatePromise': 'UPDATE promises SET done = $1 WHERE id = $2 RETURNING id',
  'adapters/inventory/pg-inventory-repository.ts#PgInventoryRepository.update': 'UPDATE inventory_items SET title = $2 WHERE id = $1 RETURNING id',
  'adapters/leads/pg-hot-leads-store.ts#PgHotLeadsStore.list': 'SELECT id FROM hot_leads WHERE status = $1 ORDER BY became_hot_at DESC NULLS LAST, id DESC LIMIT 2000',
  'adapters/leads/pg-hot-leads-store.ts#PgHotLeadsStore.update': 'UPDATE hot_leads SET status = $2 WHERE id = $1 RETURNING id',
  'adapters/leads/pg-hot-leads-store.ts#PgHotLeadsStore.setInvite': 'UPDATE hot_leads SET invite_token_hash = $2, invite_sent_at = $3::timestamptz WHERE id = $1',
  'adapters/notes/pg-note-repository.ts#PgNoteRepository.update': 'UPDATE notes SET status = $1 WHERE id = $2',
  'adapters/visits/pg-visit-store.ts#PgVisitStore.views': 'SELECT day, page FROM page_views WHERE day >= $1::date',
  'adapters/visits/pg-visit-store.ts#PgVisitStore.rollups': 'SELECT day, views FROM visit_days WHERE day >= $1::date',
  'adapters/spend/pg-model-call-event-store.ts#PgModelCallEventStore.aggregateByClass': 'SELECT spend_class, sum(cost_aed) FROM model_call_events WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY spend_class',
  'adapters/spend/pg-model-call-event-store.ts#PgModelCallEventStore.aggregateByModel': 'SELECT model, sum(cost_aed) FROM model_call_events WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY model',
};

/** Reads that scan a whole table by design: an operator report over everything. Each says why; none is rep-facing. */
const WHOLE_TABLE: Record<string, string> = {
  'adapters/spend/pg-cost-report-store.ts#PgCostReportStore.claude': 'Admin cost report: every model call grouped by rep and period (a rollup is the fix if it ever gets slow)',
  'adapters/spend/pg-cost-report-store.ts#PgCostReportStore.voice': 'Admin cost report: every transcription',
  'adapters/spend/pg-cost-report-store.ts#PgCostReportStore.revenue': 'Admin cost report: every payment',
  'adapters/spend/pg-cost-report-store.ts#PgCostReportStore.capSpend': 'Admin cost report: spend per rep per period (one row per rep, period and class)',
  'adapters/funnel/pg-funnel-source.ts#PgFunnelSource.people': 'Admin funnel: every lead and every access request',
  'adapters/access/pg-access-request-repository.ts#PgAccessRequestRepository.list': 'Admin access requests list (every request, newest first)',
  'adapters/visits/pg-visit-store.ts#PgVisitStore.views': 'Admin visits: page views over the chosen window (most of the table)',
  'adapters/visits/pg-visit-store.ts#PgVisitStore.rollups': 'Admin visits: daily rollups over the chosen window',
  'adapters/visits/pg-visit-store.ts#PgVisitStore.gamesSince': 'Admin visits: game events over the chosen window',
  'adapters/visits/pg-visit-store.ts#PgVisitStore.rollupBefore': 'Nightly: clears every day before today from visit_excluded (the table only holds a day or two)',
  'adapters/spend/pg-cost-report-store.ts#PgCostReportStore.legacyInvoices': 'Admin cost report: every invoice',
  'adapters/spend/pg-cost-report-store.ts#PgCostReportStore.subscriptions': 'Admin cost report: every subscription',
  'adapters/auth/pg-user-repository.ts#PgUserRepository.listAllIds': 'Every rep, for the jobs that run over everyone (nightly priorities, the digests); the sweep no longer uses it',
};

const SKIP = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET |CREATE|ALTER|LISTEN|NOTIFY|LOCK)\b/i;
const keyOf = (q: FoundQuery) => `${q.file}#${q.fn}`;

suite('[P86] every app query uses an index on a seeded Postgres 16', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let rep: string;
  const queries = appQueries(SRC);

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN_URL });
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
    pool.on('error', () => {}); // [P87] teardown drops this database WITH (FORCE): a connection still closing is ended (57P01), which node-pg raises on the pool. Not a test result.
    const c = await pool.connect();
    try {
      await runMigrations(c, loadMigrations(fileURLToPath(new URL('../../migrations', import.meta.url))));
      await c.query(readFileSync(fileURLToPath(new URL('./query-plans.seed.sql', import.meta.url)), 'utf8'));
      await c.query('ANALYZE');
    } finally { c.release(); }
    rep = (await pool.query('SELECT user_id FROM notes GROUP BY user_id ORDER BY user_id LIMIT 1')).rows[0].user_id;
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin?.end();
  });

  it('the seed makes every growing table large enough for a missing index to show', async () => {
    const { rows } = await pool.query(`SELECT relname, reltuples::bigint AS n FROM pg_class WHERE relkind = 'r' AND relname = ANY($1)`, [GROWING]);
    const small = rows.filter((r) => Number(r.n) < 1_000).map((r) => `${r.relname}: ${r.n}`);
    expect(rows).toHaveLength(GROWING.length);
    expect(small).toEqual([]);
  });

  it('finds the app\'s queries in the source', () => {
    expect(queries.length).toBeGreaterThan(300);
  });

  it('no app query plans a sequential scan of a growing table', async () => {
    const growing = new Set(GROWING);
    const failures: string[] = [];
    const explained = new Set<string>();
    for (const q of queries) {
      const key = keyOf(q);
      if (key in WHOLE_TABLE) continue;
      const sql = q.dynamic ? STAND_IN[key] : q.sql;
      if (!sql) { failures.push(`${q.file}:${q.line} ${q.fn}: SQL built at runtime; add a representative query to STAND_IN`); continue; }
      if (SKIP.test(sql) || /set_config|pg_(try_)?advisory/.test(sql)) continue;
      if (q.dynamic && explained.has(key)) continue;
      explained.add(key);
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        if (q.tenant) { await c.query('SET LOCAL ROLE tovira_app'); await c.query(`SELECT set_config('app.user_id', $1, true)`, [rep]); }
        const { rows } = await c.query(`EXPLAIN (GENERIC_PLAN, FORMAT JSON) ${sql}`);
        const seq: string[] = [];
        (function walk(n: { 'Node Type': string; 'Relation Name'?: string; Plans?: unknown[] }) {
          if (n['Node Type'] === 'Seq Scan' && n['Relation Name'] && growing.has(n['Relation Name'])) seq.push(n['Relation Name']);
          for (const p of (n.Plans ?? []) as Array<typeof n>) walk(p);
        })(rows[0]['QUERY PLAN'][0].Plan);
        if (seq.length > 0) failures.push(`${q.file}:${q.line} ${q.fn}: sequential scan of ${[...new Set(seq)].join(', ')}`);
      } catch (err) {
        failures.push(`${q.file}:${q.line} ${q.fn}: could not be planned (${(err as Error).message})`);
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
        c.release();
      }
    }
    expect(failures, 'add an index (CREATE INDEX CONCURRENTLY, in a no-transaction migration) or explain the whole-table read in WHOLE_TABLE').toEqual([]);
  }, 120_000);

  it('every stand-in and whole-table entry still names a query in the code (the lists stay true)', () => {
    const keys = new Set(queries.map(keyOf));
    expect(Object.keys(STAND_IN).filter((k) => !keys.has(k))).toEqual([]);
    expect(Object.keys(WHOLE_TABLE).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('every foreign key has an index on its referencing columns', async () => {
    // Covered when an index leads with the FK's columns, or (for a composite (user_id, x) key) leads with x: x is a
    // uuid unique across reps, so an index on it finds the rows as fast as one on (user_id, x).
    const { rows } = await pool.query(`
      WITH fk AS (
        SELECT c.conrelid, c.conrelid::regclass::text AS tbl, c.conkey,
               (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
          FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace)
      SELECT tbl, cols FROM fk
       WHERE NOT EXISTS (
         SELECT 1 FROM pg_index i
          WHERE i.indrelid = fk.conrelid AND i.indisvalid
            AND (((i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] @> fk.conkey AND (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] <@ fk.conkey)
              OR (array_length(fk.conkey, 1) > 1 AND (SELECT attname FROM pg_attribute WHERE attrelid = fk.conrelid AND attnum = (i.indkey::int2[])[0]) = ANY (fk.cols)
                  AND (SELECT attname FROM pg_attribute WHERE attrelid = fk.conrelid AND attnum = (i.indkey::int2[])[0]) <> 'user_id')))`);
    expect(rows.map((r) => `${r.tbl} (${(r.cols as string[]).join(', ')})`)).toEqual([]);
  });
});
