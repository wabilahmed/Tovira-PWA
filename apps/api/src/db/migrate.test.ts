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

/**
 * [P86 · index audit] CREATE INDEX CONCURRENTLY cannot run inside a transaction, so a migration whose first line is
 * `-- migrate:no-transaction` runs its statements one by one, outside BEGIN/COMMIT. To keep "never half-applied",
 * such a migration may hold ONLY idempotent `CREATE INDEX CONCURRENTLY IF NOT EXISTS` statements: a failure part-way
 * leaves the migration unrecorded, and the next boot re-runs it to completion. A concurrent build that failed leaves
 * an INVALID index behind (IF NOT EXISTS would then skip it forever), so the runner removes that leftover first.
 */
describe('runMigrations: no-transaction index migrations', () => {
  const idx: Migration = {
    name: '0004_indexes.sql',
    sql: [
      '-- migrate:no-transaction',
      '-- why these indexes',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON a (user_id, note_id);',
      '',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS b_idx ON b (user_id, client_id)',
      '  WHERE client_id IS NOT NULL;',
    ].join('\n'),
  };

  class NoTxClient extends FakeClient {
    invalid: string[] = [];
    override async query(sql: string, params: unknown[] = []) {
      if (/indisvalid/.test(sql)) {
        this.queries.push(sql.trim());
        return { rows: this.invalid.filter((n) => (params[0] as string[]).includes(n)).map((relname) => ({ relname })) };
      }
      return super.query(sql, params);
    }
  }

  it('runs each statement on its own, outside a transaction, then records the migration', async () => {
    const client = new NoTxClient();
    const result = await runMigrations(client, [migrations[0]!, idx]);
    expect(result.applied).toEqual(['0001_init.sql', '0004_indexes.sql']);
    expect(client.committed.has('0004_indexes.sql')).toBe(true);
    const a = client.queries.findIndex((q) => q.startsWith('CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx'));
    const b = client.queries.findIndex((q) => q.startsWith('CREATE INDEX CONCURRENTLY IF NOT EXISTS b_idx'));
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(client.queries[b]).toContain('WHERE client_id IS NOT NULL');
    // no BEGIN between the last COMMIT of 0001 and the index statements
    const lastBeginBeforeA = client.queries.slice(0, a).lastIndexOf('BEGIN');
    const lastCommitBeforeA = client.queries.slice(0, a).lastIndexOf('COMMIT');
    expect(lastCommitBeforeA).toBeGreaterThan(lastBeginBeforeA);
  });

  it('leaves the migration unrecorded when a statement fails, so the next boot re-runs it', async () => {
    const client = new NoTxClient();
    client.failOn = 'b_idx';
    await expect(runMigrations(client, [idx])).rejects.toThrow(/0004_indexes\.sql/);
    expect(client.committed.has('0004_indexes.sql')).toBe(false);
    client.failOn = null;
    const again = await runMigrations(client, [idx]);
    expect(again.applied).toEqual(['0004_indexes.sql']);
  });

  it('removes an INVALID leftover from a failed concurrent build before re-creating it', async () => {
    const client = new NoTxClient();
    client.invalid = ['a_idx'];
    await runMigrations(client, [idx]);
    const drop = client.queries.findIndex((q) => /^DROP INDEX CONCURRENTLY IF EXISTS "?a_idx"?$/.test(q));
    const create = client.queries.findIndex((q) => q.startsWith('CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx'));
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
    expect(client.queries.some((q) => /DROP INDEX CONCURRENTLY IF EXISTS "?b_idx"?/.test(q))).toBe(false);
  });

  it('refuses a no-transaction migration that holds anything but CREATE INDEX CONCURRENTLY IF NOT EXISTS', async () => {
    const client = new NoTxClient();
    const bad: Migration = { name: '0005_bad.sql', sql: '-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS c_idx ON c (x);\nALTER TABLE c ADD COLUMN y int;' };
    await expect(runMigrations(client, [bad])).rejects.toThrow(/0005_bad\.sql.*only CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
    expect(client.queries.some((q) => q.includes('c_idx ON c'))).toBe(false); // nothing ran
    expect(client.committed.has('0005_bad.sql')).toBe(false);
  });
});
