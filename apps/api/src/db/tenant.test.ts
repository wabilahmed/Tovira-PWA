import { describe, it, expect } from 'vitest';
import { withTenant } from './tenant.js';

interface Recorded {
  sql: string;
  params?: unknown[];
}

class FakeClient {
  queries: Recorded[] = [];
  released = false;
  failOn: string | null = null;
  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    this.queries.push({ sql, params });
    if (this.failOn && sql.includes(this.failOn)) throw new Error(`boom: ${this.failOn}`);
    return { rows: [] };
  }
  release(): void {
    this.released = true;
  }
}

class FakePool {
  client = new FakeClient();
  async connect(): Promise<FakeClient> {
    return this.client;
  }
}

// [P0-4] withTenant establishes the per-request tenant context that RLS reads:
// a transaction that sets app.user_id, so a non-superuser connection sees only
// the caller's rows. Fail-closed: if it can't set the context, it rolls back.
describe('withTenant', () => {
  it('opens a tx, sets app.user_id (transaction-local), runs the callback, commits', async () => {
    const pool = new FakePool();
    const result = await withTenant(pool as never, 'user-A', async (c) => {
      await c.query('SELECT * FROM clients');
      return 'done';
    });
    expect(result).toBe('done');

    const sqls = pool.client.queries.map((q) => q.sql);
    expect(sqls[0]).toBe('BEGIN');
    // set_config with is_local = true → scoped to this transaction only.
    const setConfig = pool.client.queries[1]!;
    expect(setConfig.sql).toContain('set_config');
    expect(setConfig.params).toEqual(['app.user_id', 'user-A']);
    expect(sqls).toContain('SELECT * FROM clients');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(pool.client.released).toBe(true);
  });

  it('sets the tenant context BEFORE running the callback query', async () => {
    const pool = new FakePool();
    await withTenant(pool as never, 'user-A', async (c) => {
      await c.query('SELECT 1');
      return null;
    });
    const idxSet = pool.client.queries.findIndex((q) => q.sql.includes('set_config'));
    const idxWork = pool.client.queries.findIndex((q) => q.sql === 'SELECT 1');
    expect(idxSet).toBeGreaterThanOrEqual(0);
    expect(idxSet).toBeLessThan(idxWork);
  });

  it('rolls back and releases the connection when the callback throws', async () => {
    const pool = new FakePool();
    await expect(
      withTenant(pool as never, 'user-A', async () => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
    const sqls = pool.client.queries.map((q) => q.sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(pool.client.released).toBe(true);
  });

  it('rolls back if setting the tenant context itself fails (fail-closed)', async () => {
    const pool = new FakePool();
    pool.client.failOn = 'set_config';
    await expect(withTenant(pool as never, 'user-A', async () => 'never')).rejects.toThrow();
    const sqls = pool.client.queries.map((q) => q.sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(pool.client.released).toBe(true);
  });
});
