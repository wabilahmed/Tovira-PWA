import { describe, it, expect } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limiter.js';

describe('FixedWindowRateLimiter', () => {
  it('allows up to `max` failures, then blocks', () => {
    const rl = new FixedWindowRateLimiter(3, 60_000);
    const t0 = 1_000_000;
    expect(rl.check('k', t0).limited).toBe(false);
    rl.record('k', t0); // 1
    rl.record('k', t0); // 2
    expect(rl.check('k', t0).limited).toBe(false); // 2 < 3
    rl.record('k', t0); // 3
    const gate = rl.check('k', t0);
    expect(gate.limited).toBe(true); // 3 >= 3
    expect(gate.retryAfterSec).toBeGreaterThan(0);
  });

  it('resets once the window rolls over', () => {
    const rl = new FixedWindowRateLimiter(2, 60_000);
    const t0 = 0;
    rl.record('k', t0);
    rl.record('k', t0);
    expect(rl.check('k', t0).limited).toBe(true);
    expect(rl.check('k', t0 + 60_000).limited).toBe(false); // window elapsed
  });

  it('clear() unblocks immediately (success path)', () => {
    const rl = new FixedWindowRateLimiter(1, 60_000);
    rl.record('k', 0);
    expect(rl.check('k', 0).limited).toBe(true);
    rl.clear('k');
    expect(rl.check('k', 0).limited).toBe(false);
  });

  it('keys are independent', () => {
    const rl = new FixedWindowRateLimiter(1, 60_000);
    rl.record('a', 0);
    expect(rl.check('a', 0).limited).toBe(true);
    expect(rl.check('b', 0).limited).toBe(false);
  });
});
