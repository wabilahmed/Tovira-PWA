import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadMigrations, runMigrations } from '../../apps/api/src/db/migrate.js';

/**
 * [INV-ISOLATION] The integration proof: inventory isolation DEMONSTRATED against a real
 * Postgres with the real migrations (0001–0041), not the in-memory repo or a fake runner.
 * "Declared" and "enforced" are different states — the deal-value IDOR lived in that gap.
 *
 * Sits in the existing integration suite (test/integration/**, run via `npm run test:integration`)
 * beside rls.integration.test.ts. That sibling brings up the compose stack itself; this one runs
 * the real migration set through the real runner against a Postgres named by INTEGRATION_DATABASE_URL
 * (a SUPERUSER connection to a throwaway DB) — so it also runs where the Docker daemon is absent.
 * Skipped in the normal unit run and when the URL is unset.
 *
 * Every negative assertion carries a positive control, or a test that only ever fails would
 * masquerade as proof. The app role tovira_app (non-superuser) is what makes RLS FORCE meaningful —
 * reads/writes go through it, never the superuser.
 */
const ADMIN_URL = process.env.INTEGRATION_DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../apps/api/migrations', import.meta.url));

function appUrl(admin: string): string {
  const u = new URL(admin);
  u.username = 'tovira_app';
  u.password = 'tovira_app';
  return u.toString();
}

/** Run fn inside a tenant transaction as the tovira_app role (RLS in force). */
async function asTenant<T>(pool: Pool, userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
/** Attempt something that should fail; capture the pg error code + constraint. */
async function expectFailure(pool: Pool, userId: string, sql: string, params: unknown[]): Promise<{ code?: string; constraint?: string }> {
  try {
    await asTenant(pool, userId, (c) => c.query(sql, params));
    return {};
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    return { code: err.code, constraint: err.constraint };
  }
}

describe.skipIf(!ADMIN_URL)('[INV-ISOLATION] real-Postgres proof (migrations 0001–0041)', () => {
  let admin: Pool;
  let app: Pool;
  const A = { user: '', client: '', item: '', share: '' };
  const B = { user: '', client: '', item: '' };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    // Run the REAL migration set through the REAL runner (this is SQL that has never executed).
    const client = await admin.connect();
    try {
      await runMigrations(client, loadMigrations(MIGRATIONS_DIR));
    } finally {
      client.release();
    }
    // Two real tenants + a client and item each (seeded as superuser; users has no tenant RLS).
    const mkUser = async (email: string): Promise<string> =>
      (await admin.query('INSERT INTO users (email, password_hash, referral_code) VALUES ($1, $2, $3) RETURNING id', [email, 'x', randomUUID().slice(0, 12)])).rows[0].id as string;
    const mkClient = async (uid: string, name: string): Promise<string> =>
      (await admin.query('INSERT INTO clients (user_id, name) VALUES ($1, $2) RETURNING id', [uid, name])).rows[0].id as string;
    const mkItem = async (uid: string): Promise<string> =>
      (await admin.query('INSERT INTO inventory_items (user_id, title, description, quantity) VALUES ($1, $2, $3, $4) RETURNING id', [uid, 'title', 'desc', 5])).rows[0].id as string;

    A.user = await mkUser('a@iso.test'); A.client = await mkClient(A.user, 'A client'); A.item = await mkItem(A.user);
    B.user = await mkUser('b@iso.test'); B.client = await mkClient(B.user, 'B client'); B.item = await mkItem(B.user);
    // A shares its item with its own client (for the read + cascade tests).
    A.share = (await admin.query('INSERT INTO inventory_shares (user_id, item_id, client_id) VALUES ($1, $2, $3) RETURNING id', [A.user, A.item, A.client])).rows[0].id as string;

    app = new Pool({ connectionString: appUrl(ADMIN_URL!) });
  }, 60_000);

  afterAll(async () => { await app?.end(); await admin?.end(); });

  // ---- 1. Composite FK rejects a cross-tenant reference (DB, not app code) ----
  it('composite FK: B referencing A\'s client is a foreign-key violation (+ positive control)', async () => {
    const bad = await expectFailure(app, B.user, 'INSERT INTO inventory_shares (user_id, item_id, client_id) VALUES ($1, $2, $3)', [B.user, B.item, A.client]);
    expect(bad.code, 'should be 23503 foreign_key_violation, not a null/check/handler').toBe('23503');
    expect(bad.constraint).toMatch(/client/);
    // positive control: B → B's own client + item succeeds
    const ok = await asTenant(app, B.user, (c) => c.query('INSERT INTO inventory_shares (user_id, item_id, client_id) VALUES ($1, $2, $3) RETURNING id', [B.user, B.item, B.client]));
    expect(ok.rowCount).toBe(1);
  });

  it('composite FK: B referencing A\'s item is a foreign-key violation', async () => {
    const bad = await expectFailure(app, B.user, 'INSERT INTO inventory_shares (user_id, item_id, client_id) VALUES ($1, $2, $3)', [B.user, A.item, B.client]);
    expect(bad.code).toBe('23503');
    expect(bad.constraint).toMatch(/item/);
  });

  // ---- 2. RLS blocks cross-tenant reads (app filter removed) + FORCE in effect ----
  it('RLS: as B, a raw query for A\'s rows (no user_id predicate) returns zero (+ control as A)', async () => {
    for (const [table, aRowId] of [['inventory_items', A.item], ['inventory_shares', A.share]] as const) {
      // Raw query by A's exact id, no user_id predicate — RLS is the only thing that can hide it.
      const asB = await asTenant(app, B.user, (c) => c.query(`SELECT id FROM ${table} WHERE id = $1`, [aRowId]));
      expect(asB.rowCount, `${table}: B must NOT see A's row`).toBe(0);
      // positive control: A sees its own row (proves RLS filters, the row isn't just absent)
      const asA = await asTenant(app, A.user, (c) => c.query(`SELECT id FROM ${table} WHERE id = $1`, [aRowId]));
      expect(asA.rowCount, `${table}: A sees its own row (control)`).toBe(1);
    }
  });

  it('FORCE ROW LEVEL SECURITY is applied on both tables (catalog check)', async () => {
    const { rows } = await admin.query(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('inventory_items','inventory_shares') ORDER BY relname",
    );
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} RLS enabled`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} FORCE`).toBe(true);
    }
  });

  // ---- 3. Writes cannot be aimed at another tenant ----
  it('as B, UPDATE/DELETE of A\'s item affects 0 rows; A\'s row is unchanged', async () => {
    const upd = await asTenant(app, B.user, (c) => c.query('UPDATE inventory_items SET quantity = 999 WHERE id = $1', [A.item]));
    expect(upd.rowCount).toBe(0);
    const del = await asTenant(app, B.user, (c) => c.query('DELETE FROM inventory_items WHERE id = $1', [A.item]));
    expect(del.rowCount).toBe(0);
    const still = await asTenant(app, A.user, (c) => c.query('SELECT quantity FROM inventory_items WHERE id = $1', [A.item]));
    expect(still.rows[0].quantity).toBe(5); // untouched
  });

  it('as B, INSERT carrying A\'s user_id is rejected by RLS WITH CHECK', async () => {
    const bad = await expectFailure(app, B.user, 'INSERT INTO inventory_items (user_id, title, description) VALUES ($1, $2, $3)', [A.user, 'x', 'y']);
    expect(bad.code, 'RLS WITH CHECK / policy violation (42501)').toBe('42501');
  });

  // ---- 4. Cascade on client deletion: share removed, item survives ----
  it('deleting a client cascades its shares but the inventory item survives (never delete items)', async () => {
    const beforeShares = await asTenant(app, A.user, (c) => c.query('SELECT count(*)::int AS n FROM inventory_shares WHERE item_id = $1', [A.item]));
    expect(beforeShares.rows[0].n).toBe(1);
    await asTenant(app, A.user, (c) => c.query('DELETE FROM clients WHERE id = $1', [A.client]));
    const afterShares = await asTenant(app, A.user, (c) => c.query('SELECT count(*)::int AS n FROM inventory_shares WHERE item_id = $1', [A.item]));
    const item = await asTenant(app, A.user, (c) => c.query('SELECT id FROM inventory_items WHERE id = $1', [A.item]));
    expect(afterShares.rows[0].n, 'the share cascaded away with the client').toBe(0);
    expect(item.rowCount, 'the inventory item SURVIVES the client deletion').toBe(1);
  });
});
