import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadMigrations, runMigrations, type MigrationClient } from './migrate.js';

/**
 * [DEPLOY-READY] Integration audit over the REAL migration set and the REAL
 * runner. It does not need a live Postgres — the Docker stack proves the SQL
 * itself applies on boot — but it guards the failure modes a live boot can't:
 * a lost migration (gap in the sequence), a duplicate number, a mis-ordered
 * file, or a runner that skips one. From empty, every migration must apply once,
 * in order; a second run must be a clean no-op.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Minimal transactional fake: COMMIT promotes the run's inserts; the runner's
 *  own schema_migrations bookkeeping is honoured so "already applied" works. */
class FakeClient implements MigrationClient {
  private committed = new Set<string>();
  private pending: string[] = [];
  async query(sql: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>> }> {
    const head = sql.trim().toUpperCase();
    if (head === 'BEGIN') return (this.pending = []), { rows: [] };
    if (head === 'COMMIT') return this.pending.forEach((n) => this.committed.add(n)), (this.pending = []), { rows: [] };
    if (head === 'ROLLBACK') return (this.pending = []), { rows: [] };
    if (head.includes('SCHEMA_MIGRATIONS')) {
      if (head.startsWith('INSERT')) this.pending.push(String(params[0]));
      if (head.startsWith('SELECT')) return { rows: [...this.committed].map((name) => ({ name })) };
      return { rows: [] };
    }
    return { rows: [] }; // a migration body — the fake doesn't execute SQL
  }
}

describe('[DEPLOY-READY] migrations inventory', () => {
  const migrations = loadMigrations(MIGRATIONS_DIR);

  it('is numbered contiguously from 0001 with no gaps or duplicates', () => {
    const numbers = migrations.map((m) => {
      const match = /^(\d{4})_/.exec(m.name);
      expect(match, `migration "${m.name}" must start with a 4-digit number`).not.toBeNull();
      return Number(match![1]);
    });
    expect(numbers.length).toBeGreaterThanOrEqual(34);
    // Strictly increasing by exactly 1, starting at 1 (contiguous, unique, ordered).
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });

  it('applies EVERY migration once, in filename order, from an empty database', async () => {
    const client = new FakeClient();
    const { applied } = await runMigrations(client, migrations);
    expect(applied).toEqual(migrations.map((m) => m.name));
  });

  it('is idempotent — a second run from the same state applies nothing', async () => {
    const client = new FakeClient();
    await runMigrations(client, migrations);
    const second = await runMigrations(client, migrations);
    expect(second.applied).toEqual([]);
  });

  it('includes the email-verification migration (0034) in the set', () => {
    expect(migrations.some((m) => m.name === '0034_email_verification.sql')).toBe(true);
  });
});
