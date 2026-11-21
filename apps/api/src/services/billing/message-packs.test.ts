import { describe, it, expect } from 'vitest';
import {
  MONTHLY_MESSAGES, PLAN_PRICE_AED, TOP_UP_PACKS, TOP_UP_OPTIONS, CUSTOM_PACK,
  customPackPriceFils, customPackRateFilsPer1000, customPackCheck, customPackId, packMessages, packGateAed, purchasableTopUp, loadConfig,
} from '../../config.js';

/**
 * [P83 · owner, 21 Nov] Messages are what a rep buys. AED 299 = 10,000 messages a month. Packs: +1,500 for AED 50,
 * +3,000 for AED 100, +5,000 for AED 150. A custom pack: 1,000 to 50,000 messages in steps of 500, at AED 33 per 1,000
 * up to 4,999 and AED 30 per 1,000 from 5,000, the exact price (no rounding). Nothing is ever cheaper per message than
 * the plan's AED 30 per 1,000.
 */
const perThousand = (aed: number, messages: number) => (aed / messages) * 1000;

describe('[P83] the plan and the fixed packs', () => {
  it('AED 299 = 10,000 messages a month', () => {
    expect(MONTHLY_MESSAGES).toBe(10_000);
    expect(PLAN_PRICE_AED).toBe(299);
    expect(loadConfig({ DATABASE_URL: 'postgres://x' }).monthlyMessages).toBe(10_000);
  });
  it('exactly three packs: +1,500 for AED 50, +3,000 for AED 100, +5,000 for AED 150', () => {
    expect(TOP_UP_PACKS.map((p) => [p.priceAed, p.messages])).toEqual([[50, 1500], [100, 3000], [150, 5000]]);
    expect(TOP_UP_OPTIONS.map((o) => o.label)).toEqual(['+1,500 messages', '+3,000 messages', '+5,000 messages']);
  });
  it('NEGATIVE: no pack is cheaper per message than the plan rate (AED 30 per 1,000)', () => {
    for (const p of TOP_UP_PACKS) expect(perThousand(p.priceAed, p.messages)).toBeGreaterThanOrEqual(30);
  });
  it('a pack credits its messages, and gate headroom at the plan ratio (AED 60 per 10,000 = AED 0.006 a message)', () => {
    expect(packMessages('topup_50')).toBe(1500);
    expect(packMessages('topup_150')).toBe(5000);
    expect(packGateAed(1500, 60, 10_000)).toBeCloseTo(9, 9);
    expect(packGateAed(5000, 60, 10_000)).toBeCloseTo(30, 9);
  });
  it('a retired pack id still credits what it was sold for (its share of the month, in messages)', () => {
    expect(packMessages('topup_15')).toBe(1500);
    expect(packMessages('topup_25')).toBe(2500);
    expect(packMessages('topup_75')).toBe(7500);
    expect(purchasableTopUp('topup_15')).toBeUndefined();
  });
  it('NEGATIVE: an unknown id credits nothing', () => {
    expect(packMessages('topup_999')).toBeNull();
    expect(packMessages('custom_abc')).toBeNull();
  });
});

describe('[P83] the custom pack price', () => {
  it('the range is 1,000 to 50,000 in steps of 500', () => {
    expect([CUSTOM_PACK.min, CUSTOM_PACK.max, CUSTOM_PACK.step]).toEqual([1000, 50_000, 500]);
  });
  it('AED 33 per 1,000 up to 4,999; AED 30 per 1,000 from 5,000 (the boundaries)', () => {
    expect(customPackPriceFils(1000)).toBe(3300); // AED 33.00
    expect(customPackPriceFils(4500)).toBe(14_850); // the last step below 5,000: AED 148.50
    expect(customPackPriceFils(5000)).toBe(15_000); // AED 150.00
    expect(customPackPriceFils(50_000)).toBe(150_000); // AED 1,500.00
  });
  it('4,999 sits in the AED 33 band, but is not a valid amount (steps of 500), so it can never be charged', () => {
    expect(customPackRateFilsPer1000(4999)).toBe(3300);
    expect(customPackRateFilsPer1000(5000)).toBe(3000);
    expect(customPackCheck(4999)).toEqual({ ok: false, message: 'Choose a number in steps of 500 (for example 4,500 or 5,000).' });
    expect(() => customPackPriceFils(4999)).toThrow(/steps of 500/);
  });
  it('the exact price, to 2 decimals: 1,500 = AED 49.50, 2,000 = AED 66.00', () => {
    expect(customPackPriceFils(1500)).toBe(4950);
    expect(customPackPriceFils(2000)).toBe(6600);
    expect(customPackPriceFils(7500)).toBe(22_500);
  });
  it('NEGATIVE: never below the plan rate, anywhere in the range', () => {
    for (let n = CUSTOM_PACK.min; n <= CUSTOM_PACK.max; n += CUSTOM_PACK.step) {
      expect(perThousand(customPackPriceFils(n) / 100, n)).toBeGreaterThanOrEqual(30);
    }
  });
  it('NEGATIVE: out of range, not a whole number, or off the step is refused with a clear message', () => {
    expect(customPackCheck(500)).toEqual({ ok: false, message: 'The smallest amount is 1,000 messages.' });
    expect(customPackCheck(50_500)).toEqual({ ok: false, message: 'The largest amount is 50,000 messages.' });
    expect(customPackCheck(1250)).toEqual({ ok: false, message: 'Choose a number in steps of 500 (for example 1,000 or 1,500).' });
    expect(customPackCheck(Number.NaN)).toEqual({ ok: false, message: 'Type how many messages you want, from 1,000 to 50,000.' });
    expect(customPackCheck(1500.5).ok).toBe(false);
    expect(customPackCheck(1500)).toEqual({ ok: true });
    expect(customPackCheck(50_000)).toEqual({ ok: true });
  });
  it('a custom pack id carries its message count, and credits exactly that', () => {
    expect(customPackId(2500)).toBe('custom_2500');
    expect(packMessages('custom_2500')).toBe(2500);
    expect(packMessages('custom_1250')).toBeNull(); // off the step: never credited
    expect(packMessages('custom_60000')).toBeNull(); // out of range
  });
});
