/**
 * [VAT-READY] UAE VAT, built now and switched OFF by default (Prospera is below the AED 375k
 * registration threshold today). Two rulings shape this:
 *
 *  1. AED 299 is VAT-INCLUSIVE when VAT applies. The price never changes on registration day — its
 *     composition does. Prospera absorbs the VAT: net drops from 299 to ~284.76, tax ~14.24. So VAT
 *     is DECOMPOSED out of the inclusive total, never added on top.
 *  2. A registration DATE, not just a flag. An invoice's tax status is a property of its OWN date vs
 *     the registration boundary — invoices before it are ordinary forever, on/after it are tax
 *     invoices. Nothing is reclassified retroactively when the flag flips (see the frozen
 *     InvoiceTaxRecord — this policy computes the treatment AT ISSUE; the record freezes it).
 *
 * Non-UAE customers are ZERO-RATED EXPORTS — a tax invoice at 0%, never charged VAT even when
 * registration is on (already load-bearing in the COGS model). An unknown country defaults to UAE
 * (taxed): zero-rating an export requires positive proof the customer is outside the UAE.
 */
export interface VatConfig {
  registered: boolean;
  trn: string | null;
  rate: number; // a fraction, e.g. 0.05 for 5%
  registeredFromMs: number | null;
}

export interface InvoiceTreatment {
  taxInvoice: boolean;
  zeroRated: boolean;
  totalFils: number;
  netFils: number;
  vatFils: number;
  rate: number;
  trn: string | null;
}

function isUae(country: string | null | undefined): boolean {
  const c = (country ?? '').trim().toUpperCase();
  return c === '' || c === 'AE'; // unknown → UAE (taxed), the conservative default
}

export class VatPolicy {
  constructor(private readonly cfg: VatConfig) {}

  get registered(): boolean {
    return this.cfg.registered;
  }
  get trn(): string | null {
    return this.cfg.trn;
  }

  /** An invoice dated `dateMs` is a tax invoice iff registration is enabled AND a registration date
   *  is set AND the invoice date is on or after it. The boundary is a property of the invoice's date. */
  isTaxInvoiceAt(dateMs: number): boolean {
    return this.cfg.registered && this.cfg.registeredFromMs !== null && dateMs >= this.cfg.registeredFromMs;
  }

  /** The tax treatment of an invoice at issue time — VAT decomposed out of the inclusive total for a
   *  UAE customer, zero for a non-UAE export or when this is not a tax invoice. */
  treat(args: { dateMs: number; country: string | null | undefined; totalFils: number }): InvoiceTreatment {
    const { dateMs, country, totalFils } = args;
    if (!this.isTaxInvoiceAt(dateMs)) {
      return { taxInvoice: false, zeroRated: false, totalFils, netFils: totalFils, vatFils: 0, rate: 0, trn: null };
    }
    if (!isUae(country)) {
      return { taxInvoice: true, zeroRated: true, totalFils, netFils: totalFils, vatFils: 0, rate: 0, trn: this.cfg.trn };
    }
    const vatFils = Math.round((totalFils * this.cfg.rate) / (1 + this.cfg.rate));
    return { taxInvoice: true, zeroRated: false, totalFils, netFils: totalFils - vatFils, vatFils, rate: this.cfg.rate, trn: this.cfg.trn };
  }
}

/** Build the policy from loaded config (the app constructs one at boot). */
export function vatPolicyFrom(cfg: VatConfig): VatPolicy {
  return new VatPolicy(cfg);
}
