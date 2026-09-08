/**
 * [VAT-BOUNDARY] A FROZEN, per-invoice tax-treatment record. Its whole purpose is immutability: the
 * treatment is computed AT ISSUE from the invoice's own date + the config in force then, written
 * ONCE, and never mutated by a later config change. This is what makes the historical boundary a
 * property of the tax record, not of today's flag — an invoice issued before registration stays an
 * ordinary invoice forever, and turning the switch off never strips VAT from invoices issued while
 * it was on. Stripe owns invoice numbering + generation; this owns the durable tax classification.
 */
export interface InvoiceTaxRecord {
  invoiceId: string; // Stripe invoice id — the stable key
  userId: string | null;
  issuedAtMs: number; // the invoice's supply date (drives the boundary)
  country: string | null;
  totalFils: number;
  taxInvoice: boolean;
  zeroRated: boolean;
  netFils: number;
  vatFils: number;
  rate: number;
  trn: string | null;
  createdAt: number;
}

export type NewInvoiceTaxRecord = Omit<InvoiceTaxRecord, 'createdAt'>;

export interface InvoiceTaxRepository {
  /** Write the treatment ONCE. If a record for this invoice already exists it is returned UNCHANGED
   *  (a re-delivered webhook, or a config change, can never rewrite a frozen tax record). */
  recordOnce(rec: NewInvoiceTaxRecord): Promise<InvoiceTaxRecord>;
  get(invoiceId: string): Promise<InvoiceTaxRecord | null>;
}
