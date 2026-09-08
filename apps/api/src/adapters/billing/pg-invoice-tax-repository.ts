import type { Pool } from 'pg';
import type { InvoiceTaxRepository, InvoiceTaxRecord, NewInvoiceTaxRecord } from '../../ports/invoice-tax-repository.js';

interface Row {
  invoice_id: string; user_id: string | null; issued_at: Date; country: string | null;
  total_fils: string; tax_invoice: boolean; zero_rated: boolean; net_fils: string; vat_fils: string;
  rate: number; trn: string | null; created_at: Date;
}
const toRec = (r: Row): InvoiceTaxRecord => ({
  invoiceId: r.invoice_id, userId: r.user_id, issuedAtMs: r.issued_at.getTime(), country: r.country,
  totalFils: Number(r.total_fils), taxInvoice: r.tax_invoice, zeroRated: r.zero_rated,
  netFils: Number(r.net_fils), vatFils: Number(r.vat_fils), rate: r.rate, trn: r.trn, createdAt: r.created_at.getTime(),
});
const COLS = 'invoice_id, user_id, issued_at, country, total_fils, tax_invoice, zero_rated, net_fils, vat_fils, rate, trn, created_at';

/** SYSTEM table (webhook-populated, no user context) — no RLS. Insert-once: a frozen record is never
 *  updated, so ON CONFLICT DO NOTHING then read back guarantees the first treatment always wins. */
export class PgInvoiceTaxRepository implements InvoiceTaxRepository {
  constructor(private readonly pool: Pool) {}

  async recordOnce(rec: NewInvoiceTaxRecord): Promise<InvoiceTaxRecord> {
    await this.pool.query(
      `INSERT INTO invoice_tax (invoice_id, user_id, issued_at, country, total_fils, tax_invoice, zero_rated, net_fils, vat_fils, rate, trn)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (invoice_id) DO NOTHING`,
      [rec.invoiceId, rec.userId, rec.issuedAtMs, rec.country, rec.totalFils, rec.taxInvoice, rec.zeroRated, rec.netFils, rec.vatFils, rec.rate, rec.trn],
    );
    const stored = await this.get(rec.invoiceId);
    if (!stored) throw new Error(`invoice_tax insert failed for ${rec.invoiceId}`);
    return stored;
  }

  async get(invoiceId: string): Promise<InvoiceTaxRecord | null> {
    const { rows } = await this.pool.query(`SELECT ${COLS} FROM invoice_tax WHERE invoice_id = $1`, [invoiceId]);
    return rows[0] ? toRec(rows[0] as unknown as Row) : null;
  }
}
