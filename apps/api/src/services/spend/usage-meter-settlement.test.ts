import { describe, it, expect, afterEach } from 'vitest';
import { AiGate, setAiGate } from './ai-gate.js';
import { allowanceWindow } from './ai-period.js';
import { anthropicCostUsd, usdToAed, type AnthropicUsage } from './ai-prices.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';
import { GatedModelClient } from '../../adapters/spend/gated-ai-clients.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';

/**
 * [P20-1a] Proof that the usage meter settles each model call at EXACTLY tokens × the configured price —
 * input, output, cache-WRITE and cache-READ — not "correct by inspection". The settle path is: gated
 * call → AiGate reserves the worst case → runs → settles usdToAed(anthropicCostUsd(model, usage)) into the
 * month's spentAed. We assert spentAed equals the independent token-math for a Sonnet extraction (cold
 * cache-write), a Haiku Ask (warm cache-read) and a Sonnet pointer run.
 */
const WINDOW = { status: 'active' as const, trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-10-01T00:00:00Z') };
const NOW = Date.parse('2026-10-17T16:00:00Z');
const KEY = allowanceWindow(WINDOW, NOW).key;

function gateWith(allowanceAed = 60): InMemoryAiAllowanceRepository {
  const allowance = new InMemoryAiAllowanceRepository();
  setAiGate(new AiGate({ allowance, allowanceAed, alertThresholdAed: 1e12, billingWindowFor: async () => WINDOW, isPaused: () => false, now: () => NOW }));
  return allowance;
}
afterEach(() => setAiGate(null));

const stub = (usage: AnthropicUsage): ModelClient => ({ complete: async () => ({ text: '{}', usage }) });
const req = (spendClass: ModelCompletionRequest['spendClass']): ModelCompletionRequest => ({ system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10, userId: 'rep', spendClass });

async function spent(allowance: InMemoryAiAllowanceRepository): Promise<number> {
  return (await allowance.getMonth('rep', KEY))?.spentAed ?? 0;
}

describe('[P20-1a] usage meter settles at the configured price', () => {
  it('a Sonnet extraction settles at input+output+cacheWrite priced, × the AED peg', async () => {
    const allowance = gateWith();
    const usage: AnthropicUsage = { inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 4000, cacheReadInputTokens: 0 };
    await new GatedModelClient(stub(usage), 'claude-sonnet-5').complete(req('extraction'));
    // Independent math: (1000·2 + 500·10 + 4000·4 + 0·0.2)/1e6 USD → AED.
    expect(await spent(allowance)).toBeCloseTo(usdToAed((1000 * 2 + 500 * 10 + 4000 * 4) / 1_000_000), 12);
  });

  it('a Haiku Ask settles at the Haiku rates incl cache-READ', async () => {
    const allowance = gateWith();
    const usage: AnthropicUsage = { inputTokens: 200, outputTokens: 120, cacheReadInputTokens: 4000 };
    await new GatedModelClient(stub(usage), 'claude-haiku-4-5-20251001').complete(req('recall'));
    // (200·1 + 120·5 + 4000·0.1)/1e6 USD → AED.
    expect(await spent(allowance)).toBeCloseTo(usdToAed((200 * 1 + 120 * 5 + 4000 * 0.1) / 1_000_000), 12);
  });

  it('three calls (extraction + Ask + pointer) sum to the exact token-priced total', async () => {
    const allowance = gateWith();
    const ex: AnthropicUsage = { inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 4000 };
    const ask: AnthropicUsage = { inputTokens: 200, outputTokens: 120, cacheReadInputTokens: 4000 };
    const ptr: AnthropicUsage = { inputTokens: 800, outputTokens: 300, cacheReadInputTokens: 3000 };
    await new GatedModelClient(stub(ex), 'claude-sonnet-5').complete(req('extraction'));
    await new GatedModelClient(stub(ask), 'claude-haiku-4-5-20251001').complete(req('recall'));
    await new GatedModelClient(stub(ptr), 'claude-sonnet-5').complete(req('pointers'));
    const expected =
      usdToAed(anthropicCostUsd('claude-sonnet-5', ex)) +
      usdToAed(anthropicCostUsd('claude-haiku-4-5-20251001', ask)) +
      usdToAed(anthropicCostUsd('claude-sonnet-5', ptr));
    expect(await spent(allowance)).toBeCloseTo(expected, 12);
  });
});
