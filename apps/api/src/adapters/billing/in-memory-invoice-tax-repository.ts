import type { InvoiceTaxRepository, InvoiceTaxRecord, NewInvoiceTaxRecord } from '../../ports/invoice-tax-repository.js';

/** In-memory frozen invoice-tax store (tests + local). Insert-once; existing always wins. */
export class InMemoryInvoiceTaxRepository implements InvoiceTaxRepository {
  private readonly rows = new Map<string, InvoiceTaxRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async recordOnce(rec: NewInvoiceTaxRecord): Promise<InvoiceTaxRecord> {
    const existing = this.rows.get(rec.invoiceId);
    if (existing) return existing; // frozen — never overwrite
    const stored: InvoiceTaxRecord = { ...rec, createdAt: this.now() };
    this.rows.set(rec.invoiceId, stored);
    return stored;
  }

  async get(invoiceId: string): Promise<InvoiceTaxRecord | null> {
    return this.rows.get(invoiceId) ?? null;
  }
}
