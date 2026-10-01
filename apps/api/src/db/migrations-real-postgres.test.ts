import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, runMigrations } from './migrate.js';
import { PgAccessRequestRepository } from '../adapters/access/pg-access-request-repository.js';
import { PgInviteRepository } from '../adapters/access/pg-invite-repository.js';
import { PgAccessApprovalTx } from '../adapters/access/pg-access-approval-tx.js';
import { PgInviteActivationTx } from '../adapters/access/pg-invite-activation-tx.js';
import { PgUserRepository } from '../adapters/auth/pg-user-repository.js';

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
      sourceIp: '198.51.100.5', userAgent: 'pg-test', referralCode: 'ref-pg',
    });
    expect(rec.referralCode).toBe('ref-pg');
    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec.status).toBe('pending');
    expect(rec.tradeLicenceNumber).toBe('TL-PG');
    expect(rec.confirmationAcceptedAt).toBe(1_750_000_000_000);
    expect(rec.reviewedAt).toBeNull();
    expect(rec.linkedUserId).toBeNull();
  });

  it('PgAccessApprovalTx.approve commits user+invite+flip atomically; PgInviteRepository consumes once (BETA-5)', async () => {
    const requests = new PgAccessRequestRepository(pool);
    const users = new PgUserRepository(pool);
    const invites = new PgInviteRepository(pool);
    const tx = new PgAccessApprovalTx(pool, users);
    const now = Date.now();

    const req = await requests.create({
      fullName: 'Tx Rep', workEmail: 'tx-approve@x.com', phone: '1', companyName: 'Co', roleTitle: 'Broker',
      ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-TX', conversationOwnership: 'own_clients',
      conversationOwnershipOther: null, expectedVolume: 'under_50', confirmationAcceptedAt: now, confirmationTextVersion: 'v',
      sourceIp: null, userAgent: null, referralCode: null,
    });

    const { userId, record } = await tx.approve({
      accessRequestId: req.id, email: 'tx-approve@x.com', passwordHash: 'scrypt$00$00',
      userReferralCode: 'rc-tx', invite: { tokenHash: 'th-approve', expiresAt: now + 7 * 86400_000, createdBy: 'ops' },
      reviewedAt: now,
    });
    expect(record.status).toBe('invited');
    expect(record.linkedUserId).toBe(userId);
    expect(await invites.hasOutstanding(userId, now)).toBe(true);

    const consumed = await invites.consume('th-approve', now);
    expect(consumed).toEqual({ userId, accessRequestId: req.id });
    expect(await invites.consume('th-approve', now)).toBeNull(); // single-use
    expect(await invites.hasOutstanding(userId, now)).toBe(false);
  });

  it('PgInviteActivationTx is single-use under CONCURRENCY — two parallel accepts, exactly one wins (BETA-6)', async () => {
    const requests = new PgAccessRequestRepository(pool);
    const tx = new PgInviteActivationTx(pool, new PgUserRepository(pool));
    const now = Date.now();
    const req = await requests.create({
      fullName: 'Race', workEmail: 'race@x.com', phone: '1', companyName: 'Co', roleTitle: 'Broker',
      ownership: 'employed', tradeLicenceNumber: null, conversationOwnership: 'brokerage_employs_me',
      conversationOwnershipOther: null, expectedVolume: 'under_50', confirmationAcceptedAt: now, confirmationTextVersion: 'v',
      sourceIp: null, userAgent: null, referralCode: null,
    });
    // Seed the invited account + a known invite directly (raw SQL is allowed in tests).
    const userId = (await pool.query<{ id: string }>(`INSERT INTO users (email, password_hash, referral_code) VALUES ('race@x.com', 'scrypt$unusable', 'rc-race') RETURNING id`)).rows[0]!.id;
    await pool.query(`UPDATE access_requests SET status = 'invited', linked_user_id = $2 WHERE id = $1`, [req.id, userId]);
    await pool.query(`INSERT INTO invites (token_hash, access_request_id, user_id, expires_at, created_by) VALUES ('th-race', $1, $2, to_timestamp($3 / 1000.0), 'ops')`, [req.id, userId, now + 7 * 86400_000]);

    const input = { tokenHash: 'th-race', now, passwordHash: 'scrypt$set', termsVersion: '2026-09-22', termsAcceptedIp: '1.1.1.1' };
    const [a, b] = await Promise.all([tx.activate(input), tx.activate({ ...input, termsAcceptedIp: '2.2.2.2' })]);
    const wins = [a, b].filter((r) => r !== null);
    expect(wins).toHaveLength(1); // the row lock lets exactly one consume win
    expect(wins[0]!.userId).toBe(userId);

    const pw = (await pool.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [userId])).rows[0]!.password_hash;
    expect(pw).toBe('scrypt$set'); // the winner set the password
    const status = (await pool.query<{ status: string }>(`SELECT status FROM access_requests WHERE id = $1`, [req.id])).rows[0]!.status;
    expect(status).toBe('activated');
  });

  it('PgAccessRequestRepository.deleteStale removes old pending/rejected only, never approved/invited/activated (BETA-8)', async () => {
    const requests = new PgAccessRequestRepository(pool);
    const mk = async (status: string, ageDays: number): Promise<string> => {
      const r = await requests.create({
        fullName: 'S', workEmail: `stale-${status}-${ageDays}@x.com`, phone: '1', companyName: 'Co', roleTitle: 'R',
        ownership: 'employed', tradeLicenceNumber: null, conversationOwnership: 'brokerage_employs_me',
        conversationOwnershipOther: null, expectedVolume: 'under_50', confirmationAcceptedAt: Date.now(), confirmationTextVersion: 'v',
        sourceIp: null, userAgent: null, referralCode: null,
      });
      await pool.query(`UPDATE access_requests SET status = $2, created_at = now() - ($3 || ' days')::interval WHERE id = $1`, [r.id, status, String(ageDays)]);
      return r.id;
    };
    const oldPending = await mk('pending', 100);
    const oldRejected = await mk('rejected', 100);
    const freshPending = await mk('pending', 10);
    const oldActivated = await mk('activated', 100);
    const oldInvited = await mk('invited', 100);

    const removed = await requests.deleteStale(Date.now() - 90 * 86400_000);
    expect(removed).toBe(2);
    expect(await requests.get(oldPending)).toBeNull();
    expect(await requests.get(oldRejected)).toBeNull();
    expect(await requests.get(freshPending)).not.toBeNull();
    expect(await requests.get(oldActivated)).not.toBeNull();
    expect(await requests.get(oldInvited)).not.toBeNull();
  });
});
