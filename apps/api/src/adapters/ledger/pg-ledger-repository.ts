import type { Pool } from 'pg';
import type { DealValue, LedgerEvent, LedgerEventRecord, LedgerRepository } from '../../ports/ledger-repository.js';
import { withTenant } from '../../db/tenant.js';

interface Row {
  id: string;
  user_id: string;
  client_id: string;
  type: string;
  source_id: string;
  dedupe_key: string;
  occurred_at: Date;
}

function toRecord(row: Row): LedgerEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    type: row.type as LedgerEventRecord['type'],
    sourceId: row.source_id,
    dedupeKey: row.dedupe_key,
    occurredAt: row.occurred_at.getTime(),
  };
}

export class PgLedgerRepository implements LedgerRepository {
  constructor(private readonly pool: Pool) {}

  async record(userId: string, event: LedgerEvent): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO ledger_events (user_id, client_id, type, source_id, dedupe_key, occurred_at)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
         ON CONFLICT (user_id, dedupe_key) DO NOTHING
         RETURNING id`,
        [userId, event.clientId, event.type, event.sourceId, event.dedupeKey, event.occurredAt],
      );
      return rows.length > 0;
    });
  }

  async listByUser(userId: string): Promise<LedgerEventRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, user_id, client_id, type, source_id, dedupe_key, occurred_at
         FROM ledger_events WHERE user_id = $1 ORDER BY occurred_at DESC`,
        [userId],
      );
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async removeBySource(userId: string, sourceId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(`DELETE FROM ledger_events WHERE user_id = $1 AND source_id = $2`, [userId, sourceId]);
    });
  }

  async setDealValue(userId: string, clientId: string, aed: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO client_deal_values (user_id, client_id, aed) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, client_id) DO UPDATE SET aed = EXCLUDED.aed`,
        [userId, clientId, aed],
      );
    });
  }

  async listDealValues(userId: string): Promise<DealValue[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT client_id, aed FROM client_deal_values WHERE user_id = $1`, [userId]);
      return (rows as unknown as Array<{ client_id: string; aed: string }>).map((r) => ({ clientId: r.client_id, aed: Number(r.aed) }));
    });
  }
}
