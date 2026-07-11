import type { Pool } from 'pg';

export interface TenantQueryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Minimal Pool surface withTenant needs (so tests can pass a fake). */
interface Connectable {
  connect(): Promise<TenantQueryable & { release(): void }>;
}

/**
 * Run `fn` inside a transaction that carries the tenant context RLS reads.
 *
 * The API connects as a NON-superuser role, so Postgres Row-Level Security is
 * always in force. `set_config('app.user_id', …, true)` scopes the caller's id
 * to this transaction; policies compare it to each row's `user_id`. If anything
 * fails — including setting the context — we roll back (fail-closed) and never
 * leak a connection back to the pool mid-transaction.
 */
export async function withTenant<T>(
  pool: Pool,
  userId: string,
  fn: (client: TenantQueryable) => Promise<T>,
): Promise<T> {
  const client = await (pool as unknown as Connectable).connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the tx is already doomed; surface the original error */
    }
    throw err;
  } finally {
    client.release();
  }
}
