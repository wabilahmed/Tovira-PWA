/**
 * Minimal, transactional migration runner. Runs on API boot.
 *
 * Principle (P0-1): a corrupt/failing migration must ABORT the boot, REPORT the
 * offending file, and leave the DB un-changed for that migration — never a
 * half-applied schema. Each migration runs inside its own transaction; a failure
 * rolls it back and stops the run (later migrations are never attempted).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrationClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface Migration {
  name: string;
  sql: string;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
  readonly migration: string;
  constructor(migration: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Migration "${migration}" failed and was rolled back: ${reason}`);
    this.migration = migration;
    this.cause = cause;
  }
}

const SCHEMA_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

/** Load *.sql migrations from a directory, sorted by filename (lexicographic). */
export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/**
 * [P86 · index audit] `CREATE INDEX CONCURRENTLY` builds an index without blocking writes, but Postgres refuses it
 * inside a transaction. A migration whose first line is `-- migrate:no-transaction` therefore runs statement by
 * statement, outside BEGIN/COMMIT. The P0-1 principle still holds because such a migration may contain ONLY
 * idempotent `CREATE INDEX CONCURRENTLY IF NOT EXISTS` statements: if one fails, the migration is not recorded and
 * the next boot re-runs it to completion; statements that already succeeded are no-ops. A concurrent build that
 * fails leaves an INVALID index of that name (which IF NOT EXISTS would then skip forever), so any such leftover is
 * removed before its statement runs.
 */
const NO_TRANSACTION = /^\s*--\s*migrate:no-transaction\b/;
const CONCURRENT_INDEX = /^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+("?)([a-z_][a-z0-9_]*)\2\s/i;

function statementsOf(sql: string): string[] {
  const body = sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  return body
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function runNoTransaction(client: MigrationClient, migration: Migration): Promise<void> {
  const statements = statementsOf(migration.sql);
  const names: string[] = [];
  for (const s of statements) {
    const m = CONCURRENT_INDEX.exec(s);
    if (!m) {
      throw new MigrationError(
        migration.name,
        new Error(`a no-transaction migration may contain only CREATE INDEX CONCURRENTLY IF NOT EXISTS statements; found: ${s.slice(0, 80)}`),
      );
    }
    names.push(m[3]!.toLowerCase());
  }
  try {
    const { rows } = await client.query(
      `SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE NOT i.indisvalid AND c.relnamespace = current_schema()::regnamespace AND c.relname = ANY($1)`,
      [names],
    );
    const invalid = new Set(rows.map((r) => String(r.relname)));
    for (let i = 0; i < statements.length; i++) {
      if (invalid.has(names[i]!)) await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${names[i]}"`);
      await client.query(statements[i]!);
    }
    await client.query('BEGIN');
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw new MigrationError(migration.name, err);
  }
}

export async function runMigrations(
  client: MigrationClient,
  migrations: Migration[],
): Promise<{ applied: string[] }> {
  await client.query(SCHEMA_MIGRATIONS);

  const done = new Set(
    (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => String(r.name)),
  );

  const applied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.name)) continue;

    if (NO_TRANSACTION.test(migration.sql)) {
      await runNoTransaction(client, migration);
      applied.push(migration.name);
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // Abort the whole run: do not attempt any later migration.
      throw new MigrationError(migration.name, err);
    }
    applied.push(migration.name);
  }

  return { applied };
}
