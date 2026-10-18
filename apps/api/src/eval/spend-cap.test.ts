import { describe, it, expect } from 'vitest';
import { SpendCap, SpendCapExceeded } from './spend-cap.js';

/** [P23-A3] A hard AED stop for real-model eval runs: every call's exact cost (from returned token counts
 *  at the model's real price) is added up, and the run aborts with a clear report once it passes the cap. */
describe('[P23-A3] eval spend cap', () => {
  it('accumulates exact AED per call and stops once the cap is passed', () => {
    const cap = new SpendCap(1.0); // AED
    cap.add('claude-sonnet-5-5', { inputTokens: 10_000, outputTokens: 10_000 }); // $0.12 = AED 0.4407
    expect(cap.spentAed).toBeCloseTo(0.12 * 3.6725, 6);
    expect(() => cap.add('claude-sonnet-5-5', { inputTokens: 10_000, outputTokens: 10_000 })).not.toThrow(); // AED 0.88
    expect(() => cap.add('claude-sonnet-5-5', { inputTokens: 10_000, outputTokens: 10_000 })).toThrow(SpendCapExceeded); // AED 1.32
    expect(cap.calls).toBe(3);
  });
  it('no cap (undefined) never throws but still counts', () => {
    const cap = new SpendCap(undefined);
    cap.add('claude-haiku-5-5', { inputTokens: 50_000, outputTokens: 0 }); // under the 100k line → base tier
    expect(cap.spentAed).toBeCloseTo(0.005 * 3.6725, 9);
  });
  it('fromEnv reads GATE_SPEND_CAP_AED; a non-number is refused', () => {
    expect(SpendCap.fromEnv({ GATE_SPEND_CAP_AED: '12.5' }).capAed).toBe(12.5);
    expect(SpendCap.fromEnv({}).capAed).toBeUndefined();
    expect(() => SpendCap.fromEnv({ GATE_SPEND_CAP_AED: 'lots' })).toThrow(/GATE_SPEND_CAP_AED/);
  });
});
