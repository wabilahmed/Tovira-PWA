/**
 * Port: an ops-only, CROSS-TENANT read of extraction prompt-cache usage over
 * time (CACHE-TRACK). Deliberately separate from the RLS-scoped extraction log —
 * the cache is org-scoped, so the advisor needs the whole stream, and it reads
 * only aggregate, non-PII columns (timestamp + cache token counts). Runs on the
 * superuser connection (RLS-bypassing), never on a request path.
 */

export interface CacheEventRow {
  /** Call time (epoch ms). */
  at: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface CacheStatsRepository {
  /** Recent extraction cache events since `sinceMs`, oldest-first. */
  recentCacheEvents(sinceMs: number): Promise<CacheEventRow[]>;
}
