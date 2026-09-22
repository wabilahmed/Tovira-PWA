import { describe, it, expect } from 'vitest';
import { ModelBudget, BudgetExceededError, callCostUsd } from './model-budget.js';

describe('[TEST-BUDGET] ModelBudget', () => {
  it('prices a cache read far below an uncached input token', () => {
    const uncached = callCostUsd('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 0 });
    const cached = callCostUsd('claude-sonnet-5', { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 1_000_000 });
    expect(uncached).toBeCloseTo(2, 5); // Sonnet 5 input = $2/MTok
    expect(cached).toBeCloseTo(0.2, 5); // 0.1x — the whole point of caching
    expect(cached).toBeLessThan(uncached);
  });

  // GUARD: pin both rows to Anthropic's published list rates so the table can't drift a generation
  // again (the sonnet-5 row once held Sonnet 4.6's $3/$15/$6/$0.30 — a silent 1.5x over-count).
  // Cache write here is the 1-HOUR tier (2x input) — every caching path in this codebase uses ttl '1h'.
  it('prices both models at Anthropic published list rates (USD/MTok)', () => {
    const at = (model: string, u: Parameters<typeof callCostUsd>[1]) => callCostUsd(model, u);
    const M1 = { inputTokens: 1_000_000, outputTokens: 0 };
    const O1 = { inputTokens: 0, outputTokens: 1_000_000 };
    const W1 = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 1_000_000 };
    const R1 = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 1_000_000 };
    // Claude Sonnet 5: $2 / $10 / 1h-write $4.00 / read $0.20
    expect(at('claude-sonnet-5', M1)).toBeCloseTo(2, 6);
    expect(at('claude-sonnet-5', O1)).toBeCloseTo(10, 6);
    expect(at('claude-sonnet-5', W1)).toBeCloseTo(4, 6);
    expect(at('claude-sonnet-5', R1)).toBeCloseTo(0.2, 6);
    // Claude Haiku 4.5: $1 / $5 / 1h-write $2.00 / read $0.10
    const H = 'claude-haiku-4-5-20251001';
    expect(at(H, M1)).toBeCloseTo(1, 6);
    expect(at(H, O1)).toBeCloseTo(5, 6);
    expect(at(H, W1)).toBeCloseTo(2, 6);
    expect(at(H, R1)).toBeCloseTo(0.1, 6);
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
    b.record('extraction', 'claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 0 }); // ~$2
    expect(() => b.check()).toThrow(BudgetExceededError);
  });

  it('stays within budget for a cheap cached burst', () => {
    // 20 cached Sonnet calls ≈ $0.043 (reads at 0.1x dominate over the tiny inputs).
    const b = new ModelBudget(0.1, 0.25);
    for (let i = 0; i < 20; i++) b.record('extraction', 'claude-sonnet-5', { inputTokens: 80, outputTokens: 60, cacheReadInputTokens: 7000 });
    expect(() => b.check()).not.toThrow();
    expect(b.totalUsd()).toBeLessThan(0.1);
  });
});
