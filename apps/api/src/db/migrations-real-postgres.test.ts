import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, runMigrations } from './migrate.js';
import { PgAccessRequestRepository } from '../adapters/access/pg-access-request-repository.js';

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

  // ── BETA-2b: access_requests CHECK invariants + invites single-use burn, proven at the DB ──
  const ar = (cols: Record<string, string>): string => {
    const base: Record<string, string> = {
      full_name: `'A'`, work_email: `'a@x.com'`, phone: `'1'`, company_name: `'C'`, role_title: `'R'`,
      ownership: `'owns_or_manages'`, conversation_ownership: `'own_clients'`, expected_volume: `'under_50'`,
      confirmation_accepted_at: 'now()', confirmation_text_version: `'cft-2026-09-22'`,
      ...cols,
    };
    const keys = Object.keys(base);
    return `INSERT INTO access_requests (${keys.join(', ')}) VALUES (${keys.map((k) => base[k]).join(', ')}) RETURNING id`;
  };

  it('access_requests enforces the two CHECK invariants (BETA-2b)', async () => {
    const client = await pool.connect();
    try {
      // valid owns_or_manages row WITH a licence is accepted
      await expect(client.query(ar({ trade_licence_number: `'TL-100'` }))).resolves.toBeTruthy();
      // employed + a trade licence → rejected (employed applicants structurally have no licence)
      await expect(
        client.query(ar({ ownership: `'employed'`, trade_licence_number: `'TL-200'` })),
      ).rejects.toThrow(/access_requests_employed_no_licence|check constraint/i);
      // other-text present but conversation_ownership is not 'other' → rejected
      await expect(
        client.query(ar({ conversation_ownership: `'mix'`, conversation_ownership_other: `'freeform'` })),
      ).rejects.toThrow(/access_requests_other_text_only_when_other|check constraint/i);
    } finally {
      client.release();
    }
  });

  it('invites single-use burn is atomic at the DB — a token consumes once, never twice, never when expired (BETA-2b)', async () => {
    const client = await pool.connect();
    try {
      const uid = (await client.query(
        `INSERT INTO users (email, password_hash, referral_code) VALUES ('inv-burn@x.com', 'h', 'rc-burn') RETURNING id`,
      )).rows[0].id as string;
      const arid = (await client.query(ar({ work_email: `'inv-burn@x.com'`, status: `'approved'` }))).rows[0].id as string;
      const insertInvite = (hash: string, expiresSql: string) =>
        client.query(
          `INSERT INTO invites (token_hash, access_request_id, user_id, expires_at, created_by) VALUES ($1, $2, $3, ${expiresSql}, 'ops')`,
          [hash, arid, uid],
        );
      const burn = (hash: string) =>
        client.query(
          `UPDATE invites SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING user_id`,
          [hash],
        );

      await insertInvite('hash-valid', `now() + interval '7 days'`);
      const first = await burn('hash-valid');
      expect(first.rowCount).toBe(1);
      expect(first.rows[0].user_id).toBe(uid);
      const second = await burn('hash-valid'); // same link reused
      expect(second.rowCount).toBe(0);

      await insertInvite('hash-expired', `now() - interval '1 day'`);
      const expired = await burn('hash-expired');
      expect(expired.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it('PgAccessRequestRepository.create round-trips against the real table (column names match) (BETA-3)', async () => {
    const repo = new PgAccessRequestRepository(pool);
    const rec = await repo.create({
      fullName: 'Pg Rep', workEmail: 'pg-rep@x.com', phone: '+971 50 000 0000', companyName: 'Pg Co',
      roleTitle: 'Broker', ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-PG',
      conversationOwnership: 'own_clients', conversationOwnershipOther: null, expectedVolume: '200_500',
      confirmationAcceptedAt: 1_750_000_000_000, confirmationTextVersion: 'cft-2026-09-22',
      sourceIp: '198.51.100.5', userAgent: 'pg-test',
    });
    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec.status).toBe('pending');
    expect(rec.tradeLicenceNumber).toBe('TL-PG');
    expect(rec.confirmationAcceptedAt).toBe(1_750_000_000_000);
    expect(rec.reviewedAt).toBeNull();
    expect(rec.linkedUserId).toBeNull();
  });
});
