import { describe, it, expect } from 'vitest';
import { RecallMetrics, type RecallTurn } from './recall-metrics.js';

const turn = (over: Partial<RecallTurn> = {}): RecallTurn => ({
  userId: 'u', turnIndex: 1, retrievalTokens: 300, historyTokens: 0,
  inputTokens: 400, outputTokens: 120, cachedTokens: 0, costAed: 0.002, ...over,
});

describe('[RECALL-METRICS] per-turn recall cost', () => {
  it('rolls up per-user and total spend', () => {
    const m = new RecallMetrics();
    m.record(turn({ userId: 'a', costAed: 0.002 }));
    m.record(turn({ userId: 'a', costAed: 0.003 }));
    m.record(turn({ userId: 'b', costAed: 0.001 }));
    expect(m.perUserRollingAed('a')).toBe(0.005);
    expect(m.perUserRollingAed('b')).toBe(0.001);
    expect(m.totalRollingAed()).toBe(0.006);
  });

  it('buckets the curve by turn index (turn 1 vs 5 vs 15)', () => {
    const m = new RecallMetrics();
    m.record(turn({ turnIndex: 1, historyTokens: 0, inputTokens: 400 }));
    m.record(turn({ turnIndex: 5, historyTokens: 1600, inputTokens: 2000 }));
    m.record(turn({ turnIndex: 15, historyTokens: 6000, inputTokens: 6400 }));
    const c = m.curve();
    expect(c[1]?.avgHistoryTokens).toBe(0);
    expect(c[5]?.avgHistoryTokens).toBe(1600);
    expect(c[15]?.avgInputTokens).toBe(6400);
    expect(c[1]?.calls).toBe(1);
  });

  it('averages within a turn bucket', () => {
    const m = new RecallMetrics();
    m.record(turn({ turnIndex: 1, costAed: 0.002, retrievalTokens: 300 }));
    m.record(turn({ turnIndex: 1, costAed: 0.004, retrievalTokens: 500 }));
    expect(m.curve()[1]?.avgCostAed).toBe(0.003);
    expect(m.curve()[1]?.avgRetrievalTokens).toBe(400);
    expect(m.curve()[1]?.calls).toBe(2);
  });

  it('drops events outside the rolling window', () => {
    let t = 1_000_000;
    const m = new RecallMetrics(1000, () => t);
    m.record(turn({ costAed: 0.01 }));
    expect(m.totalRollingAed()).toBe(0.01);
    t += 2000; // past the 1000ms window
    expect(m.totalRollingAed()).toBe(0);
    expect(m.snapshot().turns).toBe(0);
  });

  it('the snapshot reports turns, total, and the curve', () => {
    const m = new RecallMetrics();
    m.record(turn({ turnIndex: 1, costAed: 0.002 }));
    const s = m.snapshot();
    expect(s.turns).toBe(1);
    expect(s.totalAed).toBe(0.002);
    expect(s.curve[1]?.calls).toBe(1);
  });
});
