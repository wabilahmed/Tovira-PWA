import { describe, it, expect } from 'vitest';
import { AiGate, AI_RESERVATION_TTL_MS } from './ai-gate.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';
import { GatedModelClient } from '../../adapters/spend/gated-ai-clients.js';
import { setAiGate } from './ai-gate.js';
import { createExtractionModelRouter } from '../../container.js';
import { loadConfig } from '../../config.js';

/**
 * [P81-2 · owner, 21 Nov] A batched call waits minutes for its batch. The gate frees a reservation after 5 minutes (a
 * crashed live call); a batched call would lose its reservation while still running, and the cap could be overshot.
 * So a batched call reserves for BATCH_RESERVATION_TTL_MS (30 minutes); every other call keeps 5 minutes.
 */
const NOW = Date.parse('2026-10-10T00:00:00Z');
function gate(repo: InMemoryAiAllowanceRepository) {
  return new AiGate({ allowance: repo, allowanceAed: 40, alertThresholdAed: 300, billingWindowFor: async () => ({ status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-10-01T00:00:00Z') } as never), isPaused: () => false, now: () => NOW });
}
describe('[P81-2] reservation lifetime', () => {
  it('a call may ask for a longer reservation; the default stays 5 minutes', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    const seen: number[] = [];
    const orig = repo.reserve.bind(repo);
    repo.reserve = async (u, k, e, exp) => { seen.push(exp - NOW); return orig(u, k, e, exp); };
    const g = gate(repo);
    await g.run({ userId: 'u', estimateAed: 1, exec: async () => 1, actualAedFrom: () => 1 });
    await g.run({ userId: 'u', estimateAed: 1, reservationTtlMs: 30 * 60_000, exec: async () => 1, actualAedFrom: () => 1 });
    expect(seen).toEqual([AI_RESERVATION_TTL_MS, 30 * 60_000]);
  });
  it('the batched route asks for 30 minutes; NEGATIVE: the live route does not', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    const seen: number[] = [];
    const orig = repo.reserve.bind(repo);
    repo.reserve = async (u, k, e, exp) => { seen.push(exp - NOW); return orig(u, k, e, exp); };
    setAiGate(gate(repo));
    try {
      const cfg = loadConfig({ DATABASE_URL: 'postgres://t:t@localhost:5432/t', MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' });
      const fake = { complete: async () => ({ text: '{}', usage: { inputTokens: 1, outputTokens: 1 } }) };
      for (const batch of [true, false]) {
        const m = (await createExtractionModelRouter(cfg, async () => 'active', { batch })!.resolve('u')).model as GatedModelClient;
        await new GatedModelClient(fake, 'claude-sonnet-5', m.reservationTtlMs === undefined ? {} : { reservationTtlMs: m.reservationTtlMs }).complete({ userId: 'u', messages: [{ role: 'user', content: 'x' }] });
      }
    } finally { setAiGate(null); }
    expect(seen).toEqual([30 * 60_000, AI_RESERVATION_TTL_MS]);
  });
});
