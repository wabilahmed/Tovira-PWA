import { describe, it, expect } from 'vitest';
import { anthropicCostUsd } from './ai-prices.js';
import { callCostUsd } from '../metrics/model-budget.js';
import { ModelCallEventService } from './model-call-event-service.js';

/** [P81-2 · owner, 21 Nov] An answer from the Message Batches API is billed at half price: the gate's settle, the
 *  spend ledger and the call events price it so. Anything not marked is priced exactly as before. */
const U = { inputTokens: 40_000, outputTokens: 9_000, cacheReadInputTokens: 11_613, cacheCreationInputTokens: 11_613 };
describe('[P81-2] batch price', () => {
  it('a batch-marked call costs exactly half', () => {
    const full = anthropicCostUsd('claude-sonnet-5', U);
    expect(anthropicCostUsd('claude-sonnet-5', { ...U, batchDiscount: true })).toBeCloseTo(full / 2, 12);
    expect(callCostUsd('claude-sonnet-5', { ...U, batchDiscount: true })).toBeCloseTo(full / 2, 12);
  });
  it('NEGATIVE: unmarked (or false) is priced as before', () => {
    expect(anthropicCostUsd('claude-sonnet-5', { ...U, batchDiscount: false })).toBe(anthropicCostUsd('claude-sonnet-5', U));
  });
  it('the call event (ledger) records a batch call at half price', async () => {
    const rows: Array<{ costAed: number }> = [];
    const svc = new ModelCallEventService({ record: async (r: { costAed: number }) => { rows.push(r); } } as never, async () => 'p');
    await svc.record('u', 'import', 'claude-sonnet-5', U);
    await svc.record('u', 'import', 'claude-sonnet-5', { ...U, batchDiscount: true });
    expect(rows[1]!.costAed).toBeCloseTo(rows[0]!.costAed / 2, 9);
  });
});
