import type { CustomPackRange, TopUpChoice } from './allowanceClient.js';
import { groupNumber } from './usageCopy.js';

/**
 * [P83 · owner, 21 Nov] The purchase screen: the ONE place before checkout where a price is shown. The fixed packs at
 * their prices, and the custom amount priced live as the rep types (the same bands the server prices at checkout; the
 * server recalculates, the browser never sets the price).
 */

/** "AED 49.50" / "AED 1,500.00": always 2 decimals. */
export function formatAed(fils: number): string {
  return `AED ${(fils / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "+1,500 messages · AED 50.00" */
export function packPriceLabel(o: TopUpChoice): string {
  return `${o.label} · ${formatAed(o.priceAed * 100)}`;
}

/** The same rule and the same words as the server (config.ts customPackCheck). */
export function customCheck(n: number, r: CustomPackRange): { ok: true } | { ok: false; message: string } {
  if (!Number.isFinite(n)) return { ok: false, message: `Type how many messages you want, from ${groupNumber(r.min)} to ${groupNumber(r.max)}.` };
  if (n < r.min) return { ok: false, message: `The smallest amount is ${groupNumber(r.min)} messages.` };
  if (n > r.max) return { ok: false, message: `The largest amount is ${groupNumber(r.max)} messages.` };
  if (!Number.isInteger(n) || n % r.step !== 0) {
    const lo = Math.floor(n / r.step) * r.step;
    return { ok: false, message: `Choose a number in steps of ${r.step} (for example ${groupNumber(lo)} or ${groupNumber(lo + r.step)}).` };
  }
  return { ok: true };
}

/** The exact price in fils for a valid amount. */
export function customPriceFils(n: number, r: CustomPackRange): number {
  let rate = r.bands[0]?.filsPer1000 ?? 0;
  for (const b of r.bands) if (n >= b.from) rate = b.filsPer1000;
  return (n * rate) / 1000;
}
