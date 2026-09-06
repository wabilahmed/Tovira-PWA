import { describe, it, expect, afterEach, vi } from 'vitest';
import { MeteredModelClient, setSpendSink, type SpendSink } from './metered.js';
import { ModelMetricsRegistry } from '../../services/metrics/model-metrics.js';
import type { ModelClient } from '../../ports/model.js';

const inner = (usage?: { inputTokens: number; outputTokens: number }): ModelClient => ({
  complete: async () => ({ text: '{}', usage: usage ?? { inputTokens: 100, outputTokens: 10 } }),
});

afterEach(() => setSpendSink(undefined));

describe('[SPEND-CAP] MeteredModelClient records spend at the central chokepoint', () => {
  it('records when the request carries userId + spendClass', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    setSpendSink({ record } as SpendSink);
    const c = new MeteredModelClient(inner(), 'extraction', 'claude-sonnet-5', new ModelMetricsRegistry());
    await c.complete({ messages: [{ role: 'user', content: 'x' }], userId: 'rep-A', spendClass: 'extraction' });
    expect(record).toHaveBeenCalledWith('rep-A', 'extraction', 'claude-sonnet-5', { inputTokens: 100, outputTokens: 10 });
  });

  it('does NOT record an unattributed call (eval/scripts pass no userId)', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    setSpendSink({ record } as SpendSink);
    const c = new MeteredModelClient(inner(), 'extraction', 'claude-sonnet-5', new ModelMetricsRegistry());
    await c.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(record).not.toHaveBeenCalled();
  });

  it('a spend-sink failure never breaks the model call (best-effort)', async () => {
    setSpendSink({ record: vi.fn().mockRejectedValue(new Error('ledger down')) } as SpendSink);
    const c = new MeteredModelClient(inner(), 'recall', 'claude-haiku-4-5-20251001', new ModelMetricsRegistry());
    const res = await c.complete({ messages: [{ role: 'user', content: 'x' }], userId: 'rep-A', spendClass: 'recall' });
    expect(res.text).toBe('{}'); // the answer is returned regardless
  });
});
