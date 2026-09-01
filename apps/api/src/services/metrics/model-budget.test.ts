import { describe, it, expect } from 'vitest';
import { ModelBudget, BudgetExceededError, callCostUsd } from './model-budget.js';

describe('[TEST-BUDGET] ModelBudget', () => {
  it('prices a cache read far below an uncached input token', () => {
    const uncached = callCostUsd('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 0 });
    const cached = callCostUsd('claude-sonnet-5', { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 1_000_000 });
    expect(uncached).toBeCloseTo(3, 5);
    expect(cached).toBeCloseTo(0.3, 5); // ~0.1x — the whole point of caching
    expect(cached).toBeLessThan(uncached);
  });

  it('accumulates per class and reports cached vs uncached tokens', () => {
    const b = new ModelBudget(10);
    b.record('extraction', 'claude-sonnet-5', { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 7000 });
    b.record('extraction', 'claude-sonnet-5', { inputTokens: 120, outputTokens: 40, cacheCreationInputTokens: 7000 });
    const r = b.report();
    const ext = r.perClass.find((c) => c.taskClass === 'extraction')!;
    expect(ext.calls).toBe(2);
    expect(ext.cachedTokens).toBe(7000); // one read
    expect(ext.uncachedTokens).toBe(100 + 120 + 7000); // inputs + the cold write
    expect(r.totalAed).toBeGreaterThan(0);
  });

  it('aborts when spend exceeds the estimate + margin', () => {
    const b = new ModelBudget(0.001, 0.25); // tiny budget
    b.record('extraction', 'claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 0 }); // ~$3
    expect(() => b.check()).toThrow(BudgetExceededError);
  });

  it('stays within budget for a cheap cached burst', () => {
    // 20 cached Sonnet calls ≈ $0.065 (reads at 0.1x dominate over the tiny inputs).
    const b = new ModelBudget(0.1, 0.25);
    for (let i = 0; i < 20; i++) b.record('extraction', 'claude-sonnet-5', { inputTokens: 80, outputTokens: 60, cacheReadInputTokens: 7000 });
    expect(() => b.check()).not.toThrow();
    expect(b.totalUsd()).toBeLessThan(0.1);
  });
});
