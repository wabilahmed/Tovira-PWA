import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { ErasureAuditRepository, ErasureAuditRecord, ErasureAuditEntry, ErasureCategoryCount } from '../../ports/erasure-audit-repository.js';

interface Row { id: string; user_id: string; requester_names: string[]; categories: ErasureCategoryCount[]; at: Date }

/** RLS-backed erasure audit (append-only; content never stored). Cascades on account delete. */
export class PgErasureAuditRepository implements ErasureAuditRepository {
  constructor(private readonly pool: Pool) {}

  async record(userId: string, entry: ErasureAuditEntry): Promise<ErasureAuditRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO erasure_audit (user_id, requester_names, categories) VALUES ($1, $2, $3::jsonb)
         RETURNING id, user_id, requester_names, categories, at`,
        [userId, entry.requesterNames, JSON.stringify(entry.categories)],
      );
      return toRecord(rows[0] as unknown as Row);
    });
  }

  async listByUser(userId: string): Promise<ErasureAuditRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT id, user_id, requester_names, categories, at FROM erasure_audit WHERE user_id = $1 ORDER BY at DESC`, [userId]);
      return (rows as unknown as Row[]).map(toRecord);
    });
  }
}

function toRecord(r: Row): ErasureAuditRecord {
  return { id: r.id, userId: r.user_id, requesterNames: r.requester_names, categories: r.categories, at: r.at.getTime(), outcome: 'committed' };
}
