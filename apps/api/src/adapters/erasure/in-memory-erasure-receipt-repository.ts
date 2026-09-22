import type { ErasureReceipt, ErasureReceiptRepository } from '../../ports/erasure-receipt-repository.js';

/** In-memory erasure receipts. Not tenant-scoped (no userId) — mirrors the pg table's no-FK shape, so
 *  the record survives account deletion. `purgeUser` is a NO-OP on purpose (see the port doc). */
export class InMemoryErasureReceiptRepository implements ErasureReceiptRepository {
  private rows: ErasureReceipt[] = [];

  async record(receipt: ErasureReceipt): Promise<void> {
    // Store a defensive copy so a later mutation of the caller's object can't rewrite the record.
    this.rows.push({ ...receipt, categories: receipt.categories.map((c) => ({ ...c })) });
  }

  async get(requestId: string): Promise<ErasureReceipt | null> {
    return this.rows.find((r) => r.requestId === requestId) ?? null;
  }

  async list(): Promise<ErasureReceipt[]> {
    return [...this.rows];
  }

  /** NO-OP by design: a retention receipt is never removed by account deletion. */
  async purgeUser(_userId: string): Promise<void> {
    /* intentionally does nothing — the receipt outlives the account */
  }
}
