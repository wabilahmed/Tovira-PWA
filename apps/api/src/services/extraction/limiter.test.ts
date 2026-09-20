import { describe, it, expect } from 'vitest';
import { TrialExtractionLimiter } from './limiter.js';
import { InMemoryExtractionCounter } from '../../adapters/extraction/in-memory-extraction-counter.js';

// Resolver stub: a fixed status, and a period key derived from status so trial vs paid bucket differ.
function resolver(status: string, periodKey = `pk:${status}`) {
  return async () => ({ status, periodKey });
}

describe('[TRIAL-FARM] TrialExtractionLimiter — durable, status-aware, monotonic', () => {
  it('allows a trial account below the trial ceiling and blocks it at/over', async () => {
    const counter = new InMemoryExtractionCounter();
    const limiter = new TrialExtractionLimiter(resolver('trialing'), counter, { trial: 3, paid: 100 });
    for (let i = 0; i < 3; i++) {
      expect(await limiter.allow('u')).toBe(true);
      await limiter.record('u');
    }
    expect(await limiter.allow('u')).toBe(false); // at the ceiling
  });

  it('a paying (active) account gets the generous ceiling, not the trial one', async () => {
    const counter = new InMemoryExtractionCounter();
    const limiter = new TrialExtractionLimiter(resolver('active'), counter, { trial: 3, paid: 10 });
    for (let i = 0; i < 5; i++) await limiter.record('u'); // well past the trial ceiling
    expect(await limiter.allow('u')).toBe(true); // still allowed — paid ceiling is 10
    for (let i = 0; i < 5; i++) await limiter.record('u');
    expect(await limiter.allow('u')).toBe(false); // now at the paid ceiling of 10
  });

  it('past_due (a card on file) is treated as paying; expired/canceled/none get the trial ceiling', async () => {
    for (const status of ['trial_expired', 'canceled', 'none']) {
      const counter = new InMemoryExtractionCounter();
      const limiter = new TrialExtractionLimiter(resolver(status), counter, { trial: 2, paid: 999 });
      await limiter.record('u'); await limiter.record('u');
      expect(await limiter.allow('u'), `${status} should be bounded by the trial ceiling`).toBe(false);
    }
    const counter = new InMemoryExtractionCounter();
    const pastDue = new TrialExtractionLimiter(resolver('past_due'), counter, { trial: 2, paid: 999 });
    await pastDue.record('u'); await pastDue.record('u'); await pastDue.record('u');
    expect(await pastDue.allow('u'), 'past_due keeps the generous paid ceiling').toBe(true);
  });

  it('is DURABLE: the count is read from the counter, not from prunable rows — pruning cannot lower it', async () => {
    const counter = new InMemoryExtractionCounter();
    const limiter = new TrialExtractionLimiter(resolver('trialing'), counter, { trial: 2, paid: 100 });
    await limiter.record('u'); await limiter.record('u');
    expect(await limiter.allow('u')).toBe(false);
    // Archival/erasure prune LOGS, not this counter — so the block holds. (The counter has no
    // decrement; there is nothing pruning could call to lower it.)
    expect(await limiter.allow('u')).toBe(false);
  });

  it('separates buckets: the trial window and a later paid period are counted independently', async () => {
    const counter = new InMemoryExtractionCounter();
    // Same user, different period keys → independent counts.
    await counter.increment('u', 't:end'); await counter.increment('u', 't:end');
    expect(await counter.count('u', 't:end')).toBe(2);
    expect(await counter.count('u', 'p:start')).toBe(0);
  });
});
