import { describe, it, expect, vi } from 'vitest';
import { hapticTick } from './haptics.js';

describe('hapticTick', () => {
  it('fires one short vibration when the Vibration API is present', () => {
    const vibrate = vi.fn().mockReturnValue(true);
    hapticTick({ vibrate });
    expect(vibrate).toHaveBeenCalledTimes(1);
    const [arg] = vibrate.mock.calls[0]!;
    expect(typeof arg).toBe('number');
    expect(arg as number).toBeGreaterThan(0);
    expect(arg as number).toBeLessThanOrEqual(30); // short — a tick, not a buzz
  });

  // iOS PWAs have no Vibration API: feature-detect and do nothing, never throw.
  it('does nothing (and does not throw) when the Vibration API is absent', () => {
    expect(() => hapticTick({})).not.toThrow();
    expect(() => hapticTick(undefined)).not.toThrow();
  });

  it('swallows a vibrate that throws (haptics are best-effort)', () => {
    const vibrate = vi.fn(() => { throw new Error('blocked'); });
    expect(() => hapticTick({ vibrate })).not.toThrow();
  });
});
