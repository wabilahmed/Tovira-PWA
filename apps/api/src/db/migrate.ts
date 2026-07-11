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
