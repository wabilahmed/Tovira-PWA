import type { Pool } from 'pg';
import type {
  InventoryItemRecord,
  InventoryItemInput,
  InventoryItemPatch,
  InventoryRepository,
  InventoryStatus,
  InventoryShareRecord,
  ShareInput,
  ShareOutcomePatch,
  SimilarItem,
} from '../../ports/inventory-repository.js';
import { withTenant } from '../../db/tenant.js';

interface ShareRow {
  id: string;
  user_id: string;
  item_id: string;
  client_id: string;
  shared_at: Date;
  outcome: InventoryShareRecord['outcome'];
  outcome_set_by: InventoryShareRecord['outcomeSetBy'];
  quantity_bought: number | null;
}
function toShare(row: ShareRow): InventoryShareRecord {
  return { id: row.id, userId: row.user_id, itemId: row.item_id, clientId: row.client_id, sharedAt: row.shared_at.getTime(), outcome: row.outcome, outcomeSetBy: row.outcome_set_by, quantityBought: row.quantity_bought === null ? null : Number(row.quantity_bought) };
}
const SHARE_COLUMNS = 'id, user_id, item_id, client_id, shared_at, outcome, outcome_set_by, quantity_bought';

interface InventoryRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  quantity: number;
  status: InventoryStatus;
  disabled_reason: InventoryItemRecord['disabledReason'];
  embedded: boolean;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: InventoryRow): InventoryItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    quantity: Number(row.quantity),
    status: row.status,
    disabledReason: row.disabled_reason,
    embedded: row.embedded,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

// The raw vector never leaves the DB — expose only whether one is stored.
const COLUMNS = 'id, user_id, title, description, quantity, status, disabled_reason, (embedding IS NOT NULL) AS embedded, created_at, updated_at';

const vec = (e: number[] | null | undefined): string | null => (e && e.length ? `[${e.join(',')}]` : null);

/**
 * Postgres-backed inventory store. Every method runs inside a tenant transaction (RLS
 * enforced by the non-superuser connection); app-layer `WHERE user_id` is defense in
 * depth, RLS is the hard net. Cross-tenant references are composite-FK violations (0041).
 */
export class PgInventoryRepository implements InventoryRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, input: InventoryItemInput): Promise<InventoryItemRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO inventory_items (user_id, title, description, quantity, embedding)
         VALUES ($1, $2, $3, $4, $5::vector) RETURNING ${COLUMNS}`,
        [userId, input.title, input.description, input.quantity, vec(input.embedding)],
      );
      return toRecord(rows[0] as unknown as InventoryRow);
    });
  }

  async listByUser(userId: string, status?: InventoryStatus): Promise<InventoryItemRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = status === undefined
        ? await c.query(`SELECT ${COLUMNS} FROM inventory_items WHERE user_id = $1 ORDER BY created_at DESC`, [userId])
        : await c.query(`SELECT ${COLUMNS} FROM inventory_items WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC`, [userId, status]);
      return (rows as unknown as InventoryRow[]).map(toRecord);
    });
  }

  async findByIdForUser(userId: string, id: string): Promise<InventoryItemRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      // No app-layer user_id filter here — RLS alone scopes the row (same as clients).
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM inventory_items WHERE id = $1`, [id]);
      return rows.length ? toRecord(rows[0] as unknown as InventoryRow) : null;
    });
  }

  async searchByEmbedding(userId: string, queryEmbedding: number[], limit: number): Promise<SimilarItem[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS}, 1 - (embedding <=> $1::vector) AS similarity
         FROM inventory_items
         WHERE status = 'active' AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector LIMIT $2`,
        [vec(queryEmbedding), limit],
      );
      return (rows as unknown as Array<InventoryRow & { similarity: number }>).map((row) => ({ item: toRecord(row), similarity: row.similarity }));
    });
  }

  async update(userId: string, id: string, patch: InventoryItemPatch): Promise<InventoryItemRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      const add = (col: string, val: unknown): void => { params.push(val); sets.push(`${col} = $${params.length}`); };
      if (patch.title !== undefined) add('title', patch.title);
      if (patch.description !== undefined) add('description', patch.description);
      if (patch.quantity !== undefined) add('quantity', patch.quantity);
      if (patch.status !== undefined) add('status', patch.status);
      if (patch.disabledReason !== undefined) add('disabled_reason', patch.disabledReason);
      if (patch.embedding !== undefined) { params.push(vec(patch.embedding)); sets.push(`embedding = $${params.length}::vector`); }
      if (sets.length === 0) return this.findByIdForUser(userId, id);
      sets.push('updated_at = now()');
      const { rows } = await c.query(`UPDATE inventory_items SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`, params);
      return rows.length ? toRecord(rows[0] as unknown as InventoryRow) : null;
    });
  }

  async purgeUser(userId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      // inventory_shares cascade off inventory_items (FK ON DELETE CASCADE).
      await c.query('DELETE FROM inventory_items WHERE user_id = $1', [userId]);
    });
  }

  async createShare(userId: string, input: ShareInput): Promise<InventoryShareRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO inventory_shares (user_id, item_id, client_id, outcome_set_by)
         VALUES ($1, $2, $3, $4) RETURNING ${SHARE_COLUMNS}`,
        [userId, input.itemId, input.clientId, input.outcomeSetBy ?? 'rep'],
      );
      return toShare(rows[0] as unknown as ShareRow);
    });
  }

  async listSharesByItem(userId: string, itemId: string): Promise<InventoryShareRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${SHARE_COLUMNS} FROM inventory_shares WHERE user_id = $1 AND item_id = $2 ORDER BY shared_at DESC`, [userId, itemId]);
      return (rows as unknown as ShareRow[]).map(toShare);
    });
  }

  async listSharesByClient(userId: string, clientId: string): Promise<InventoryShareRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${SHARE_COLUMNS} FROM inventory_shares WHERE user_id = $1 AND client_id = $2 ORDER BY shared_at DESC`, [userId, clientId]);
      return (rows as unknown as ShareRow[]).map(toShare);
    });
  }

  async findShareForUser(userId: string, shareId: string): Promise<InventoryShareRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${SHARE_COLUMNS} FROM inventory_shares WHERE id = $1`, [shareId]);
      return rows.length ? toShare(rows[0] as unknown as ShareRow) : null;
    });
  }

  async updateShareOutcome(userId: string, shareId: string, patch: ShareOutcomePatch): Promise<InventoryShareRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `UPDATE inventory_shares SET outcome = $2, quantity_bought = $3 WHERE id = $1 RETURNING ${SHARE_COLUMNS}`,
        [shareId, patch.outcome, patch.quantityBought ?? null],
      );
      return rows.length ? toShare(rows[0] as unknown as ShareRow) : null;
    });
  }
}
