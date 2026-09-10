import type { Pool } from 'pg';
import type { TrainingLogStats, TrainingLogStatsRepository } from '../../ports/training-log-stats-repository.js';

/**
 * [TRAINING-METRICS] Cross-tenant training-log aggregate for /health. NO withTenant/RLS — it must see
 * every tenant, so give it the SUPERUSER pool (DATABASE_URL), like the cache advisor. Reads only
 * counts + prompt_version (never PII). Throttled by TrainingLogStatsService so these scans run at
 * most once per TTL, not per health check.
 */
export class PgTrainingLogStatsRepository implements TrainingLogStatsRepository {
  constructor(private readonly pool: Pool) {}

  async aggregate(nowMs: number): Promise<TrainingLogStats> {
    const sinceMs = nowMs - 24 * 60 * 60 * 1000;
    const totals = await this.pool.query<{ total: string; last24h: string; empty_output: string }>(
      `SELECT count(*)                                                                   AS total,
              count(*) FILTER (WHERE created_at >= to_timestamp($1 / 1000.0))            AS last24h,
              count(*) FILTER (WHERE raw_output IS NULL OR btrim(raw_output) = '')       AS empty_output
         FROM extraction_logs`,
      [sinceMs],
    );
    const byVersion = await this.pool.query<{ prompt_version: string; n: string }>(
      `SELECT prompt_version, count(*) AS n FROM extraction_logs GROUP BY prompt_version`,
    );
    const corr = await this.pool.query<{ n: string }>(`SELECT count(*) AS n FROM corrections`);

    const row = totals.rows[0] ?? { total: '0', last24h: '0', empty_output: '0' };
    const byPromptVersion: Record<string, number> = {};
    for (const r of byVersion.rows) byPromptVersion[r.prompt_version] = Number(r.n);

    return {
      total: Number(row.total),
      last24h: Number(row.last24h),
      emptyOutput: Number(row.empty_output),
      corrections: Number(corr.rows[0]?.n ?? '0'),
      byPromptVersion,
    };
  }
}
