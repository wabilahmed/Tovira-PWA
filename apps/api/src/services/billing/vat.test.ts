import { describe, it, expect } from 'vitest';
import { VatPolicy } from './vat.js';

const FROM = Date.parse('2026-11-01T00:00:00Z'); // a registration date
const before = Date.parse('2026-10-31T23:59:59Z');
const onBoundary = FROM;
const after = Date.parse('2026-11-02T00:00:00Z');
const PRICE = 29900; // AED 299.00 in fils

const off = new VatPolicy({ registered: false, trn: null, rate: 0.05, registeredFromMs: null });
const onFrom = (fromMs: number) => new VatPolicy({ registered: true, trn: '100xxxxxxxxxxxx', rate: 0.05, registeredFromMs: fromMs });

describe('[VAT-CONFIG] VatPolicy — the date-driven switch', () => {
  it('disabled → nothing is a tax invoice, no VAT anywhere', () => {
    expect(off.isTaxInvoiceAt(after)).toBe(false);
    const t = off.treat({ dateMs: after, country: 'AE', totalFils: PRICE });
    expect(t).toMatchObject({ taxInvoice: false, vatFils: 0, netFils: PRICE, totalFils: PRICE });
  });

  it('enabled with a FUTURE registration date → today\'s invoices carry no VAT', () => {
    const p = onFrom(after); // registration starts in the future relative to `before`
    expect(p.isTaxInvoiceAt(before)).toBe(false);
    expect(p.treat({ dateMs: before, country: 'AE', totalFils: PRICE }).vatFils).toBe(0);
  });

  it('enabled with a PAST registration date → VAT after it, none before it', () => {
    const p = onFrom(FROM);
    expect(p.isTaxInvoiceAt(before)).toBe(false); // before the boundary
    expect(p.isTaxInvoiceAt(onBoundary)).toBe(true); // the boundary date itself is a tax invoice
    expect(p.isTaxInvoiceAt(after)).toBe(true);
  });
});

describe('[VAT-STRIPE] tax treatment — AED 299 is VAT-INCLUSIVE, non-UAE zero-rated', () => {
  const p = onFrom(FROM);

  it('UAE customer with VAT on → 299 total, 284.76 net, 14.24 VAT (decomposed out of the inclusive price)', () => {
    const t = p.treat({ dateMs: after, country: 'AE', totalFils: PRICE });
    expect(t.totalFils).toBe(29900);
    expect(t.vatFils).toBe(1424); // round(29900 * 0.05 / 1.05) = round(1423.8)
    expect(t.netFils).toBe(28476);
    expect(t.taxInvoice).toBe(true);
    expect(t.zeroRated).toBe(false);
    expect(t.trn).toBe('100xxxxxxxxxxxx');
  });

  it('non-UAE customer with VAT on → 299 total, ZERO VAT (zero-rated export)', () => {
    const t = p.treat({ dateMs: after, country: 'GB', totalFils: PRICE });
    expect(t.totalFils).toBe(29900);
    expect(t.vatFils).toBe(0);
    expect(t.netFils).toBe(29900);
    expect(t.taxInvoice).toBe(true); // still a tax invoice, just 0%
    expect(t.zeroRated).toBe(true);
  });

  it('an unknown country defaults to UAE (taxed) — zero-rating an export needs positive proof', () => {
    expect(p.treat({ dateMs: after, country: null, totalFils: PRICE }).vatFils).toBe(1424);
    expect(p.treat({ dateMs: after, country: '', totalFils: PRICE }).vatFils).toBe(1424);
  });

  it('both with VAT off → 299, no tax regardless of country', () => {
    expect(off.treat({ dateMs: after, country: 'AE', totalFils: PRICE }).vatFils).toBe(0);
    expect(off.treat({ dateMs: after, country: 'GB', totalFils: PRICE }).vatFils).toBe(0);
  });
});
