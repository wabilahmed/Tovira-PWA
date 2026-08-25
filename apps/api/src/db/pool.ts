import pg from 'pg';

/**
 * A single shared connection pool for the API process. Managed Postgres (RDS)
 * requires TLS; local docker/dev does not. We detect a local host and turn TLS
 * on everywhere else. `rejectUnauthorized: false` encrypts the connection
 * without verifying the server certificate — fine inside the VPC; tighten later
 * by bundling the RDS CA bundle if you want full verification.
 */
export function createPool(databaseUrl: string): pg.Pool {
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\]|db)(:\d+)?\//.test(databaseUrl);
  return new pg.Pool({
    connectionString: databaseUrl,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });
}

export type { Pool, PoolClient } from 'pg';
