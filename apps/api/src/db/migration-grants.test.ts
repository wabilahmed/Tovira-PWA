import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadMigrations } from './migrate.js';

/**
 * [GRANT-LINT] Every table the APP touches must be GRANTed to the non-owner role `tovira_app`.
 *
 * This guards a failure class that has now bitten three times and is INVISIBLE to the in-memory
 * suite by construction ([[migrations-only-validated-live]]): a migration CREATEs a table but forgets
 * the `GRANT ... TO tovira_app` that every other table has. The migration runs as the owner, so the
 * table exists and the schema audit passes — but at runtime the API connects as `tovira_app`, and the
 * first real query raises `permission denied for table X`. It never fails in a unit test (those use
 * in-memory adapters) and often not on a smoke check (an empty table, or a path only a valid input
 * reaches), so it reaches production silently.
 *   - 0037: `referrals` (0023) — a real referral 500'd, credited no one.
 *   - 2026-09: `requirements` (0048), `inventory_matches` (0049), `inventory_match_badge_views`
 *     (0050), `note_move_audit` (0047) — `priorities-nightly` erroring live + /today 500 on cache
 *     miss + latent breaks in extraction-writes-requirements and the note-move audit trail.
 *
 * A live Postgres can't be assumed in CI, so this asserts the invariant STATICALLY over the real .sql:
 * every created table is either granted to tovira_app, or explicitly listed as OWNER-PLANE (a table
 * whose repo is built on the migration/owner pool, never the app pool — verified in index.ts).
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/**
 * Tables intentionally NOT granted to tovira_app because their pg-adapter is constructed with
 * `migrationPool` (the owner connection), not `appPool`, in index.ts. Adding a table here is a
 * deliberate decision: it says "the app role must never touch this table." Keep the justification.
 */
const OWNER_PLANE = new Set<string>([
  'ops_alerts',      // index.ts: createOpsAlertRepository(config, migrationPool) — ops/admin plane
  'spend_overrides', // index.ts: createSpendOverrideRepository(config, migrationPool) — admin plane
]);

function createdTables(sql: string): string[] {
  return [...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1]!.toLowerCase());
}

function grantedTables(sql: string): string[] {
  // GRANT <privs> ON <table[, table...]> TO tovira_app  — capture the (possibly multi-table) list
  // between ON and TO, non-greedily, then split on commas. Privilege lists sit before ON, so they
  // are excluded. `ON SCHEMA public` yields "schema public", which matches no real table — harmless.
  const out: string[] = [];
  for (const m of sql.matchAll(/\bgrant\b[a-z0-9,\s]*?\bon\s+([a-z0-9_,\s]+?)\s+to\s+tovira_app/gi)) {
    for (const t of m[1]!.split(',')) out.push(t.trim().toLowerCase());
  }
  return out;
}

describe('[GRANT-LINT] every app table is granted to tovira_app', () => {
  const migrations = loadMigrations(MIGRATIONS_DIR);
  const allSql = migrations.map((m) => m.sql).join('\n');
  const created = new Set(createdTables(allSql));
  const granted = new Set(grantedTables(allSql));

  it('grants (or owner-plane-exempts) every created table', () => {
    const ungranted = [...created].filter((t) => !granted.has(t) && !OWNER_PLANE.has(t)).sort();
    expect(ungranted, `tables created but never GRANTed to tovira_app (add the grant, or list as OWNER_PLANE with a reason): ${ungranted.join(', ')}`).toEqual([]);
  });

  it('keeps the OWNER_PLANE allowlist honest — each entry is a real table that is genuinely NOT granted', () => {
    for (const t of OWNER_PLANE) {
      expect(created.has(t), `OWNER_PLANE lists "${t}" but no migration creates it`).toBe(true);
      expect(granted.has(t), `OWNER_PLANE lists "${t}" but it IS granted to tovira_app — remove it from the allowlist`).toBe(false);
    }
  });
});
