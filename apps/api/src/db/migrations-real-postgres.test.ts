import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, runMigrations } from './migrate.js';

/**
 * [DEPLOY-READY · REAL-PG] Run the REAL migration set against a REAL Postgres.
 *
 * The sibling `migrations-inventory.test.ts` runs the same set against a FAKE client that never executes
 * SQL — so it cannot catch anything Postgres rejects at apply time: a foreign key whose column type does
 * not match its referent, a grant to a role that does not exist, an RLS predicate that won't type-check.
 * That gap shipped `0067_extraction_counters.sql` with `user_id text REFERENCES users(id)` (users.id is
 * uuid) — the fake client waved it through; the prod boot died on it and ECS rolled the deploy back.
 *
 * This test closes the gap: from an empty schema, EVERY migration must apply once, in order, against real
 * Postgres, with no throw — and a second run must be a clean no-op. It is GATED on `MIGRATIONS_TEST_DB_URL`
 * so a laptop `npm test` with no database skips it; CI ALWAYS sets it (a Postgres service), so this class of
 * bug can never again pass on the fake client alone.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
const DB_URL = process.env.MIGRATIONS_TEST_DB_URL;

const suite = DB_URL ? describe : describe.skip;

suite('[DEPLOY-READY] migrations apply against real Postgres', () => {
  const migrations = loadMigrations(MIGRATIONS_DIR);
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // A clean slate so migrations apply from empty and the run is deterministic + re-runnable. Roles are
    // cluster-global (0003 guards its own CREATE ROLE), so only the schema needs resetting.
    const reset = await pool.connect();
    try {
      await reset.query('DROP SCHEMA IF EXISTS public CASCADE');
      await reset.query('CREATE SCHEMA public');
    } finally {
      reset.release();
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('applies EVERY migration once, in order, from an empty database — no Postgres rejection', async () => {
    // BEGIN/COMMIT/ROLLBACK must ride the SAME connection, so run on a single client, not the pool.
    const client = await pool.connect();
    try {
      const { applied } = await runMigrations(client, migrations);
      expect(applied).toEqual(migrations.map((m) => m.name));
    } finally {
      client.release();
    }
  }, 60_000);

  it('landed the new-in-batch migrations with the RIGHT foreign-key types (0067 user_id is uuid, not text)', async () => {
    const client = await pool.connect();
    try {
      // 0067 exists and its user_id matches users.id (uuid) — the exact thing that failed in prod.
      const { rows } = await client.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name = 'extraction_counters' AND column_name = 'user_id'`,
      );
      expect(rows[0]?.data_type).toBe('uuid');
      // The FK to users(id) was actually created (Postgres only allows it when the types match).
      const { rows: fk } = await client.query(
        `SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'extraction_counters' AND constraint_type = 'FOREIGN KEY'`,
      );
      expect(fk.length).toBeGreaterThan(0);
      // 0068/0069 landed too (the per-call event log + its conversation columns).
      const { rows: cols } = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'model_call_events'`,
      );
      const names = cols.map((r) => r.column_name);
      expect(names).toEqual(expect.arrayContaining(['user_id', 'spend_class', 'conversation_id', 'turn_index']));
    } finally {
      client.release();
    }
  });

  it('is idempotent — a second run against the migrated database applies nothing', async () => {
    const client = await pool.connect();
    try {
      const second = await runMigrations(client, migrations);
      expect(second.applied).toEqual([]);
    } finally {
      client.release();
    }
  });
});
