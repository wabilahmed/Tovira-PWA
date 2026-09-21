import { describe, it, expect } from 'vitest';
import { ModelCallEventService } from './model-call-event-service.js';
import { InMemoryModelCallEventStore } from '../../adapters/spend/in-memory-model-call-event-store.js';
import type { ModelUsage } from '../../ports/model.js';

const SONNET = 'claude-sonnet-5';
const usage = (over: Partial<ModelUsage> = {}): ModelUsage => ({ inputTokens: 100, outputTokens: 40, thinkingTokens: 30, cacheReadInputTokens: 4000, cacheCreationInputTokens: 0, ...over });

describe('[SPEND-INSTRUMENT] ModelCallEventService records priced, bucketed per-call events', () => {
  it('records a rep call with its period bucket, tokens, cache hit, and computed cost', async () => {
    const store = new InMemoryModelCallEventStore();
    const svc = new ModelCallEventService(store, async () => 't:trial', () => 111);
    await svc.record('rep-A', 'extraction', SONNET, usage());
    const [c] = await store.aggregateByClass(0, 1000, 'rep-A');
    expect(c!.spendClass).toBe('extraction');
    expect(c!.calls).toBe(1);
    expect(c!.inputTokens).toBe(100);
    expect(c!.thinkingTokens).toBe(30);
    expect(c!.cacheReadTokens).toBe(4000);
    expect(c!.costAed).toBeGreaterThan(0); // priced via callCostUsd
  });

  it('a SYSTEM call is excluded from a rep-scoped view but present in the aggregate (invoice) total', async () => {
    const store = new InMemoryModelCallEventStore();
    const svc = new ModelCallEventService(store, async () => 't:trial', () => 500);
    await svc.record(null, 'canary', SONNET, usage()); // system → userId null
    const W = [0, 1000] as const;
    expect(await store.aggregateByClass(...W, 'rep-A')).toEqual([]); // a rep never sees system cost
    const all = await store.aggregateByClass(...W); // aggregate (no userId) DOES include system — matches the invoice
    expect(all.map((c) => c.spendClass)).toEqual(['canary']);
  });

  it('aggregateByModel sums per model with USD + AED (invoice-comparable)', async () => {
    const store = new InMemoryModelCallEventStore();
    const svc = new ModelCallEventService(store, async () => 'p:2026-10', () => 1);
    await svc.record('rep-A', 'extraction', SONNET, usage());
    await svc.record('rep-A', 'recall', 'claude-haiku-4-5-20251001', usage({ cacheReadInputTokens: 0 }));
    const models = await store.aggregateByModel(0, 1000);
    expect(models.map((m) => m.model).sort()).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5']);
    for (const m of models) { expect(m.costUsd).toBeGreaterThan(0); expect(m.costAed).toBeGreaterThan(0); }
  });
});
