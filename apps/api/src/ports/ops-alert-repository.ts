/**
 * [SPEND-CAP] Ops-facing alerts (distinct from rep-facing notifications). There is no ops inbox in
 * the product, so alerts land in a durable, cross-tenant table surfaced on /health for the operator
 * to watch. Idempotent per (kind, dedupeKey) — one alert per rep per period, not one per call over
 * the line. Written on the superuser pool (an ops row is not a rep's tenant data).
 */
export interface OpsAlert {
  id: string;
  kind: string;
  userId: string;
  dedupeKey: string;
  detail: Record<string, unknown>;
  createdAt: number;
}

export interface NewOpsAlert {
  kind: string;
  userId: string;
  dedupeKey: string;
  detail: Record<string, unknown>;
}

export interface OpsAlertRepository {
  /** Create unless one with the same (kind, dedupeKey) exists. Returns true if created. */
  createIfAbsent(alert: NewOpsAlert): Promise<boolean>;
  /** Recent alerts, newest first — for the /health ops surface. */
  listRecent(limit: number): Promise<OpsAlert[]>;
}
