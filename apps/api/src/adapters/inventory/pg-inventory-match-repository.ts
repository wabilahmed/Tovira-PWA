import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type {
  InventoryMatchRepository,
  MatchRecord,
  MatchUpsert,
  MatchConfidence,
  MatchStatus,
} from '../../ports/inventory-match-repository.js';

interface Row {
  id: string;
  user_id: string;
  requirement_id: string;
  item_id: string;
  client_id: string;
  similarity: number;
  confidence: string;
  status: string;
  created_at: Date;
  dismissed_at: Date | null;
}

function toRecord(r: Row): MatchRecord {
  return {
    id: r.id,
    userId: r.user_id,
    requirementId: r.requirement_id,
    itemId: r.item_id,
    clientId: r.client_id,
    similarity: r.similarity,
    confidence: r.confidence as MatchConfidence,
    status: r.status as MatchStatus,
    createdAt: r.created_at.getTime(),
    dismissedAt: r.dismissed_at ? r.dismissed_at.getTime() : null,
  };
}

const COLUMNS = 'id, user_id, requirement_id, item_id, client_id, similarity, confidence, status, created_at, dismissed_at';

export class PgInventoryMatchRepository implements InventoryMatchRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(userId: string, m: MatchUpsert): Promise<MatchRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const existing = await c.query(
        `SELECT ${COLUMNS} FROM inventory_matches WHERE requirement_id = $1 AND item_id = $2 FOR UPDATE`,
        [m.requirementId, m.itemId],
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0] as unknown as Row;
        if (row.status === 'dismissed') return toRecord(row); // stays dismissed — never resurfaces
        const upd = await c.query(
          `UPDATE inventory_matches SET similarity = $1, confidence = $2 WHERE id = $3 RETURNING ${COLUMNS}`,
          [m.similarity, m.confidence, row.id],
        );
        return toRecord(upd.rows[0] as unknown as Row);
      }
      const ins = await c.query(
        `INSERT INTO inventory_matches (user_id, requirement_id, item_id, client_id, similarity, confidence)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
        [userId, m.requirementId, m.itemId, m.clientId, m.similarity, m.confidence],
      );
      return toRecord(ins.rows[0] as unknown as Row);
    });
  }

  async findPairing(userId: string, requirementId: string, itemId: string): Promise<MatchRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM inventory_matches WHERE requirement_id = $1 AND item_id = $2`, [requirementId, itemId]);
      return rows[0] ? toRecord(rows[0] as unknown as Row) : null;
    });
  }

  async listOpenByClient(userId: string, clientId: string): Promise<MatchRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM inventory_matches WHERE client_id = $1 AND status = 'open' ORDER BY similarity DESC`, [clientId]);
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async listOpenByItem(userId: string, itemId: string): Promise<MatchRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM inventory_matches WHERE item_id = $1 AND status = 'open' ORDER BY similarity DESC`, [itemId]);
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async dismiss(userId: string, matchId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(`UPDATE inventory_matches SET status = 'dismissed', dismissed_at = now() WHERE id = $1 AND status = 'open'`, [matchId]);
    });
  }

  async reassignByRequirements(userId: string, requirementIds: string[], toClientId: string): Promise<number> {
    if (requirementIds.length === 0) return 0;
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('UPDATE inventory_matches SET client_id = $1 WHERE requirement_id = ANY($2::uuid[]) RETURNING id', [toClientId, requirementIds]);
      return rows.length;
    });
  }

  async deleteByRequirements(userId: string, requirementIds: string[]): Promise<number> {
    if (requirementIds.length === 0) return 0;
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('DELETE FROM inventory_matches WHERE requirement_id = ANY($1::uuid[]) RETURNING id', [requirementIds]);
      return rows.length;
    });
  }

  async purgeUser(userId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query('DELETE FROM inventory_matches WHERE user_id = $1', [userId]);
    });
  }
}
