import { describe, it, expect } from 'vitest';
import { RecallSpendGate } from './recall-spend-gate.js';
import { InMemoryRecallDailyCounter } from '../../adapters/spend/in-memory-recall-daily-counter.js';

function make(capped: boolean, limit = 3) {
  const counter = new InMemoryRecallDailyCounter();
  const gate = new RecallSpendGate({ canSpend: async () => !capped }, counter, limit);
  return { gate, counter };
}

describe('[SPEND-CAP] RecallSpendGate — recall at the cap (CAP-ENFORCE)', () => {
  it('below the cap: always allowed, never metered', async () => {
    const { gate, counter } = make(false, 3);
    for (let i = 0; i < 10; i++) expect((await gate.check('rep-A', '2026-09-06')).allowed).toBe(true);
    // Never touched the counter — recall is unlimited and unmetered for everyone below the cap.
    expect(await counter.increment('rep-A', '2026-09-06')).toBe(1);
  });

  it('at the cap: allowed up to the daily limit, then refused with a reason', async () => {
    const { gate } = make(true, 3);
    expect((await gate.check('rep-A', 'd')).allowed).toBe(true); // 1
    expect((await gate.check('rep-A', 'd')).allowed).toBe(true); // 2
    expect((await gate.check('rep-A', 'd')).allowed).toBe(true); // 3
    const over = await gate.check('rep-A', 'd'); // 4 > 3
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe('daily_cap');
  });

  it('the daily limit resets by day', async () => {
    const { gate } = make(true, 1);
    expect((await gate.check('rep-A', 'mon')).allowed).toBe(true);
    expect((await gate.check('rep-A', 'mon')).allowed).toBe(false);
    expect((await gate.check('rep-A', 'tue')).allowed).toBe(true); // new day, fresh budget
  });
});
