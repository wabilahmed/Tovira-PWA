import { describe, it, expect } from 'vitest';
import { pickTopUp, buildUpsell, BulkUpsellService } from './bulk-upsell.js';
import type { TopUpOption } from '../../config.js';

// A stand-in for config.TOP_UP_OPTIONS (addedAed = allowance added; priceAed = what the rep pays).
const OPTIONS: readonly TopUpOption[] = [
  { id: 'topup_15', addedAed: 6, priceAed: 50, label: '+15%' },
  { id: 'topup_25', addedAed: 10, priceAed: 65, label: '+25%' },
  { id: 'topup_50', addedAed: 20, priceAed: 85, label: '+50%' },
  { id: 'topup_75', addedAed: 30, priceAed: 100, label: '+75%' },
  { id: 'topup_100', addedAed: 40, priceAed: 120, label: '+100%' },
];

describe('[BULK-IMPORT] top-up upsell', () => {
  it('pickTopUp returns the SMALLEST option whose added allowance covers the shortfall', () => {
    expect(pickTopUp(5, OPTIONS)!.id).toBe('topup_15'); // 6 covers 5
    expect(pickTopUp(6, OPTIONS)!.id).toBe('topup_15'); // exactly 6
    expect(pickTopUp(7, OPTIONS)!.id).toBe('topup_25'); // 6 too small → 10
    expect(pickTopUp(25, OPTIONS)!.id).toBe('topup_75'); // 20 too small → 30
    expect(pickTopUp(1000, OPTIONS)!.id).toBe('topup_100'); // none covers → the largest
    expect(pickTopUp(5, [])).toBeNull();
  });

  it('buildUpsell flags a shortfall and highlights the covering option — prices + %, never AED usage', () => {
    const u = buildUpsell({ estimateAed: 30, remainingAed: 10, canTopUp: true, n: 8 }, OPTIONS);
    expect(u.shortfall).toBe(true);
    expect(u.n).toBe(8);
    expect(u.canTopUp).toBe(true);
    expect(u.recommendedOptionId).toBe('topup_50'); // shortfall 20 → +50% (addedAed 20)
    expect(u.options).toEqual([
      { id: 'topup_15', label: '+15%', priceAed: 50 },
      { id: 'topup_25', label: '+25%', priceAed: 65 },
      { id: 'topup_50', label: '+50%', priceAed: 85 },
      { id: 'topup_75', label: '+75%', priceAed: 100 },
      { id: 'topup_100', label: '+100%', priceAed: 120 },
    ]);
    // No AED usage values leak to the client — only the price and the percentage label.
    expect(JSON.stringify(u)).not.toContain('addedAed');
    expect(JSON.stringify(u)).not.toContain('estimateAed');
  });

  it('no shortfall when the batch fits the remaining allowance', () => {
    const u = buildUpsell({ estimateAed: 5, remainingAed: 10, canTopUp: true, n: 3 }, OPTIONS);
    expect(u.shortfall).toBe(false);
    expect(u.recommendedOptionId).toBeNull();
  });

  it('a trial account gets NO top-up options (the web shows Subscribe instead)', () => {
    const u = buildUpsell({ estimateAed: 30, remainingAed: 10, canTopUp: false, n: 8 }, OPTIONS);
    expect(u.shortfall).toBe(true);
    expect(u.canTopUp).toBe(false);
    expect(u.options).toEqual([]);
    expect(u.recommendedOptionId).toBeNull();
  });
});

describe('[BULK-IMPORT] BulkUpsellService', () => {
  const svc = (over: { remaining?: number; canTopUp?: boolean } = {}) => new BulkUpsellService({
    topUpOptions: OPTIONS,
    remainingAllowanceAed: async () => over.remaining ?? 10,
    canTopUp: async () => over.canTopUp ?? true,
  });

  it('forBatch compares the estimate to the live remaining allowance', async () => {
    const u = await svc({ remaining: 10 }).forBatch('u', 30, 8);
    expect(u.shortfall).toBe(true);
    expect(u.recommendedOptionId).toBe('topup_50');
  });

  it('forResult offers top-ups for the failed rows (no estimate needed)', async () => {
    const u = await svc({ canTopUp: true }).forResult('u', 4);
    expect(u.shortfall).toBe(true);
    expect(u.n).toBe(4);
    expect(u.options).toHaveLength(5);
  });

  it('forResult on a trial shows no options', async () => {
    const u = await svc({ canTopUp: false }).forResult('u', 2);
    expect(u.canTopUp).toBe(false);
    expect(u.options).toEqual([]);
  });
});
