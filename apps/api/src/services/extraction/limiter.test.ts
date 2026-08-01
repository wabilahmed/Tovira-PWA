import { describe, it, expect } from 'vitest';
import { TrialExtractionLimiter } from './limiter.js';

describe('TrialExtractionLimiter (P5-1)', () => {
  it('allows a trial account below the ceiling', async () => {
    const limiter = new TrialExtractionLimiter(async () => 'trialing', async () => 5, 10, () => 1);
    expect(await limiter.allow('u')).toBe(true);
  });

  it('blocks a trial account at/over the ceiling', async () => {
    const limiter = new TrialExtractionLimiter(async () => 'trialing', async () => 10, 10, () => 1);
    expect(await limiter.allow('u')).toBe(false);
  });

  it('never limits a paid (non-trial) account, even over the count', async () => {
    for (const status of ['active', 'past_due', 'none']) {
      const limiter = new TrialExtractionLimiter(async () => status, async () => 9999, 10, () => 1);
      expect(await limiter.allow('u')).toBe(true);
    }
  });
});
