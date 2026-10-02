/**
 * [EXTRACTION-METRICS] Cross-tenant aggregate over the extraction log, for /health. An empty log and a
 * working one are externally identical without this — the dark-metrics failure shape. Aggregates
 * ONLY (counts + a per-version histogram), never row content/PII ([NO-TRAINING-RETENTION]: there is no
 * content to read). Must run on a NON-RLS (superuser) connection to see every tenant, like the cache
 * advisor.
 */
export interface TrainingLogStats {
  /** All extraction-log rows. */
  total: number;
  /** Rows written in the last 24h — is the log actually growing? */
  last24h: number;
  /** Rows that proposed zero facts (starved) — a run that produced nothing. */
  emptyOutput: number;
  /** Correction rows recorded (human verdicts). */
  corrections: number;
  /** Row count per prompt version — gaps reveal dead periods. */
  byPromptVersion: Record<string, number>;
}

export interface TrainingLogStatsRepository {
  /** Compute the aggregate as of `nowMs` (for the 24h window). */
  aggregate(nowMs: number): Promise<TrainingLogStats>;
}
