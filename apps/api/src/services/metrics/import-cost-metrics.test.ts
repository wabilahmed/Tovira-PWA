import { describe, it, expect } from 'vitest';
import { ImportCostMetrics } from './import-cost-metrics.js';

const rec = (userId: string, costAed: number, over: Partial<Parameters<ImportCostMetrics['record']>[0]> = {}) => ({
  userId, clientId: 'c1', calls: 1, inputTokens: 1000, outputTokens: 200, cachedTokens: 9743, cacheWriteTokens: 0, embeddingCalls: 1, costAed, ...over,
});

describe('[COST-IMPORT-METRIC] ImportCostMetrics', () => {
  it('rolls up per-rep import spend in AED', () => {
    const m = new ImportCostMetrics();
    m.record(rec('rep-A', 0.66));
    m.record(rec('rep-A', 1.91));
    m.record(rec('rep-B', 0.22));
    expect(m.perUserRollingAed('rep-A')).toBeCloseTo(2.57, 6);
    expect(m.perUserRollingAed('rep-B')).toBeCloseTo(0.22, 6);
    expect(m.totalRollingAed()).toBeCloseTo(2.79, 6);
  });

  it('never leaks one rep\'s spend into another\'s', () => {
    const m = new ImportCostMetrics();
    m.record(rec('rep-A', 3.56));
    expect(m.perUserRollingAed('rep-B')).toBe(0);
  });

  it('prunes events older than the rolling window', () => {
    let t = 1_000_000;
    const m = new ImportCostMetrics(60 * 60 * 1000, () => t);
    m.record(rec('rep-A', 1.0));
    t += 61 * 60 * 1000; // advance past the 1h window
    m.record(rec('rep-A', 2.0));
    expect(m.perUserRollingAed('rep-A')).toBeCloseTo(2.0, 6); // the old one aged out
    expect(m.snapshot().imports).toBe(1);
  });

  it('snapshot reports count, total, and average AED', () => {
    const m = new ImportCostMetrics();
    m.record(rec('rep-A', 1.0));
    m.record(rec('rep-A', 3.0));
    const s = m.snapshot();
    expect(s.imports).toBe(2);
    expect(s.totalAed).toBeCloseTo(4.0, 6);
    expect(s.avgAed).toBeCloseTo(2.0, 6);
    // the token shape is retained for later analysis
    expect(s.totalUncachedInputTokens).toBe(2000);
  });

  it('an empty window reports zeros without dividing by zero', () => {
    const m = new ImportCostMetrics();
    const s = m.snapshot();
    expect(s).toEqual({ imports: 0, totalAed: 0, avgAed: 0, totalUncachedInputTokens: 0 });
  });
});
