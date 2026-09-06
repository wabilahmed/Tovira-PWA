import type { Pool } from 'pg';
import type { OpsAlertRepository, OpsAlert, NewOpsAlert } from '../../ports/ops-alert-repository.js';

/** Cross-tenant ops alerts on the SUPERUSER pool (RLS-bypassing) — the cache-stats precedent. */
export class PgOpsAlertRepository implements OpsAlertRepository {
  constructor(private readonly pool: Pool) {}

  async createIfAbsent(alert: NewOpsAlert): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO ops_alerts (kind, user_id, dedupe_key, detail)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (kind, dedupe_key) DO NOTHING`,
      [alert.kind, alert.userId, alert.dedupeKey, JSON.stringify(alert.detail)],
    );
    return (rowCount ?? 0) > 0;
  }

  async listRecent(limit: number): Promise<OpsAlert[]> {
    const { rows } = await this.pool.query(
      `SELECT id, kind, user_id, dedupe_key, detail, (extract(epoch from created_at) * 1000)::bigint AS created_at
         FROM ops_alerts ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return (rows as Array<{ id: string; kind: string; user_id: string; dedupe_key: string; detail: Record<string, unknown>; created_at: string }>).map((r) => ({
      id: r.id, kind: r.kind, userId: r.user_id, dedupeKey: r.dedupe_key, detail: r.detail, createdAt: Number(r.created_at),
    }));
  }
}
