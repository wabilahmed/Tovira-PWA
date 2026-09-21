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

import { setModelCallEventSink, type ModelCallEventSink } from './metered.js';
import type { ModelUsage } from '../../ports/model.js';

afterEach(() => setModelCallEventSink(undefined));
const richInner = (): ModelClient => ({
  complete: async () => ({ text: '{}', usage: { inputTokens: 100, outputTokens: 40, thinkingTokens: 30, cacheReadInputTokens: 4000, cacheCreationInputTokens: 0 } as ModelUsage }),
});

describe('[SPEND-INSTRUMENT] per-call event log + mandatory class', () => {
  it('records a per-call event with class, model, tokens, cache hit, and cost', async () => {
    const events: Array<{ userId: string | null; spendClass: string; model: string; usage: ModelUsage }> = [];
    setModelCallEventSink({ record: async (userId, spendClass, model, usage) => { events.push({ userId, spendClass, model, usage }); } } as ModelCallEventSink);
    const c = new MeteredModelClient(richInner(), 'extraction', 'claude-sonnet-5', new ModelMetricsRegistry());
    await c.complete({ messages: [{ role: 'user', content: 'x' }], userId: 'rep-A', spendClass: 'extraction' });
    expect(events).toHaveLength(1);
    expect(events[0]!).toMatchObject({ userId: 'rep-A', spendClass: 'extraction', model: 'claude-sonnet-5' });
    expect(events[0]!.usage.cacheReadInputTokens).toBe(4000); // cache visible; thinking tokens present too
    expect(events[0]!.usage.thinkingTokens).toBe(30);
  });

  it('records a SYSTEM call (no userId) account-less, with its class', async () => {
    const events: Array<{ userId: string | null; spendClass: string }> = [];
    setModelCallEventSink({ record: async (userId, spendClass) => { events.push({ userId, spendClass }); } } as ModelCallEventSink);
    const c = new MeteredModelClient(richInner(), 'extraction', 'claude-sonnet-5', new ModelMetricsRegistry());
    await c.complete({ messages: [{ role: 'user', content: 'x' }], spendClass: 'canary' }); // canary: no userId
    expect(events).toEqual([{ userId: null, spendClass: 'canary' }]);
  });

  // The load-bearing guarantee: unclassified spend is IMPOSSIBLE — a rep call without a class fails LOUD.
  it('THROWS when a rep call has no spendClass (never silently records nothing)', async () => {
    setModelCallEventSink({ record: async () => {} } as ModelCallEventSink);
    const c = new MeteredModelClient(richInner(), 'extraction', 'claude-sonnet-5', new ModelMetricsRegistry());
    await expect(c.complete({ messages: [{ role: 'user', content: 'x' }], userId: 'rep-A' })).rejects.toThrow(/no spendClass/i);
  });

  it('THROWS on an invalid spendClass (not in the closed set)', async () => {
    setModelCallEventSink({ record: async () => {} } as ModelCallEventSink);
    const c = new MeteredModelClient(richInner(), 'extraction', 'claude-sonnet-5', new ModelMetricsRegistry());
    await expect(c.complete({ messages: [{ role: 'user', content: 'x' }], userId: 'rep-A', spendClass: 'other' })).rejects.toThrow(/invalid spendClass/i);
  });
});
