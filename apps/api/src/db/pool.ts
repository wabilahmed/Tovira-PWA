import pg from 'pg';

/** A single shared connection pool for the API process. */
export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

export type { Pool, PoolClient } from 'pg';
