import type { Pool } from 'pg';
import type { ErasureReceipt, ErasureReceiptRepository } from '../../ports/erasure-receipt-repository.js';
import type { ErasureCategoryCount } from '../../ports/erasure-audit-repository.js';

interface Row { request_id: string; received_at: Date; completed_at: Date; categories: ErasureCategoryCount[] }

/**
 * [ERASURE-RECEIPT] Compliance proof-of-erasure. Root pool, NO RLS, NO user_id and NO foreign key — so
 * the `users` cascade cannot reach it and it survives account deletion (the whole point). Append-only.
 */
export class PgErasureReceiptRepository implements ErasureReceiptRepository {
  constructor(private readonly pool: Pool) {}

  async record(receipt: ErasureReceipt): Promise<void> {
    await this.pool.query(
      `INSERT INTO erasure_receipts (request_id, received_at, completed_at, categories)
       VALUES ($1, to_timestamp($2 / 1000.0), to_timestamp($3 / 1000.0), $4::jsonb)
       ON CONFLICT (request_id) DO NOTHING`,
      [receipt.requestId, receipt.receivedAt, receipt.completedAt, JSON.stringify(receipt.categories)],
    );
  }

  async get(requestId: string): Promise<ErasureReceipt | null> {
    const { rows } = await this.pool.query(
      `SELECT request_id, received_at, completed_at, categories FROM erasure_receipts WHERE request_id = $1`,
      [requestId],
    );
    return rows.length ? toReceipt(rows[0] as unknown as Row) : null;
  }

  async list(): Promise<ErasureReceipt[]> {
    const { rows } = await this.pool.query(
      `SELECT request_id, received_at, completed_at, categories FROM erasure_receipts ORDER BY completed_at DESC`,
    );
    return (rows as unknown as Row[]).map(toReceipt);
  }

  /** NO-OP by design: a retention receipt is never removed by account deletion (there is no user_id
   *  to key on, and no DELETE grant on the table). */
  async purgeUser(_userId: string): Promise<void> {
    /* intentionally does nothing */
  }
}

function toReceipt(r: Row): ErasureReceipt {
  return { requestId: r.request_id, receivedAt: r.received_at.getTime(), completedAt: r.completed_at.getTime(), categories: r.categories };
}
