import { describe, it, expect } from 'vitest';
import { runMigrations, MigrationError, type MigrationClient, type Migration } from './migrate.js';

/**
 * A fake Postgres client that models transaction semantics so we can prove the
 * runner never leaves the DB half-migrated. `committed` only changes on COMMIT;
 * a ROLLBACK (or a thrown migration body) discards the in-flight insert.
 */
class FakeClient implements MigrationClient {
  committed = new Set<string>();
  private pending: string[] = [];
  queries: string[] = [];
  /** SQL substring that should blow up when executed (simulates a corrupt migration). */
  failOn: string | null = null;

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push(sql.trim());
    const head = sql.trim().toUpperCase();

    if (head === 'BEGIN') {
      this.pending = [];
      return { rows: [] };
    }
    if (head === 'COMMIT') {
      for (const n of this.pending) this.committed.add(n);
      this.pending = [];
      return { rows: [] };
    }
    if (head === 'ROLLBACK') {
      this.pending = [];
      return { rows: [] };
    }
    // The runner's own bookkeeping (must be matched before generic CREATE/SELECT
    // so a migration body that happens to be a CREATE TABLE isn't misrouted).
    if (head.includes('SCHEMA_MIGRATIONS')) {
      if (head.startsWith('INSERT')) this.pending.push(String(params[0]));
      if (head.startsWith('SELECT')) {
        return { rows: [...this.committed].map((name) => ({ name })) };
      }
      return { rows: [] };
    }
    // Otherwise this is a migration body — the only thing that can "fail".
    if (this.failOn && sql.includes(this.failOn)) {
      throw new Error(`syntax error near "${this.failOn}"`);
    }
    return { rows: [] };
  }
}

const migrations: Migration[] = [
  { name: '0001_init.sql', sql: 'CREATE EXTENSION IF NOT EXISTS vector;' },
  { name: '0002_clients.sql', sql: 'CREATE TABLE clients (id uuid);' },
  { name: '0003_notes.sql', sql: 'CREATE TABLE notes (id uuid);' },
];

describe('runMigrations', () => {
  // POSITIVE: migrations apply on boot, in order.
  it('applies all pending migrations in filename order', async () => {
    const client = new FakeClient();
    const result = await runMigrations(client, migrations);
    expect(result.applied).toEqual(['0001_init.sql', '0002_clients.sql', '0003_notes.sql']);
    expect(client.committed).toEqual(new Set(['0001_init.sql', '0002_clients.sql', '0003_notes.sql']));
  });

  // POSITIVE: idempotent — re-running applies nothing new (data survives restart).
  it('skips already-applied migrations on a second run', async () => {
    const client = new FakeClient();
    await runMigrations(client, migrations);
    const second = await runMigrations(client, migrations);
    expect(second.applied).toEqual([]);
    expect(client.committed.size).toBe(3);
  });

  it('wraps each migration in its own transaction', async () => {
    const client = new FakeClient();
    await runMigrations(client, [migrations[0]!]);
    expect(client.queries).toContain('BEGIN');
    expect(client.queries).toContain('COMMIT');
  });

  // NEGATIVE: "Corrupt/parseless migration → boot aborts and reports the
  // offending migration; DB is not left half-migrated."
  it('aborts and names the offending migration on failure', async () => {
    const client = new FakeClient();
    client.failOn = 'CREATE TABLE clients'; // 0002 blows up
    await expect(runMigrations(client, migrations)).rejects.toBeInstanceOf(MigrationError);
    await expect(runMigrations(client, migrations)).rejects.toThrow(/0002_clients\.sql/);
  });

  it('does not leave the DB half-migrated when a migration fails', async () => {
    const client = new FakeClient();
    client.failOn = 'CREATE TABLE clients'; // 0002 blows up
    await expect(runMigrations(client, migrations)).rejects.toThrow();

    // 0001 committed; the failing 0002 rolled back; 0003 never attempted.
    expect(client.committed.has('0001_init.sql')).toBe(true);
    expect(client.committed.has('0002_clients.sql')).toBe(false);
    expect(client.committed.has('0003_notes.sql')).toBe(false);
    // The transaction for the failing migration was rolled back, not committed.
    expect(client.queries).toContain('ROLLBACK');
  });

  it('stops at the first failure and never runs later migrations', async () => {
    const client = new FakeClient();
    client.failOn = 'CREATE TABLE clients'; // 0002
    await expect(runMigrations(client, migrations)).rejects.toThrow();
    expect(client.queries.some((q) => q.includes('CREATE TABLE notes'))).toBe(false);
  });
});
