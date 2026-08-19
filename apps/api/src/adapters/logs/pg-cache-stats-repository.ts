import type { Pool } from 'pg';
import type { CacheEventRow, CacheStatsRepository } from '../../ports/cache-stats-repository.js';

/**
 * Cross-tenant cache-usage read for the tier advisor. NO withTenant / RLS scope —
 * it must see every rep's extractions (one org-scoped cache). Give it the
 * SUPERUSER pool (DATABASE_URL); the app-role pool would be filtered by RLS.
 * Reads only created_at + the cache token columns — never PII.
 */
export class PgCacheStatsRepository implements CacheStatsRepository {
  constructor(private readonly pool: Pool) {}

  async recentCacheEvents(sinceMs: number): Promise<CacheEventRow[]> {
    const { rows } = await this.pool.query<{ at: string; cc: number; cr: number }>(
      `SELECT (extract(epoch from created_at) * 1000)::bigint AS at,
              cache_creation_tokens AS cc,
              cache_read_tokens     AS cr
         FROM extraction_logs
        WHERE created_at >= to_timestamp($1 / 1000.0)
        ORDER BY created_at ASC`,
      [sinceMs],
    );
    return rows.map((r) => ({ at: Number(r.at), cacheCreationTokens: r.cc, cacheReadTokens: r.cr }));
  }
}
