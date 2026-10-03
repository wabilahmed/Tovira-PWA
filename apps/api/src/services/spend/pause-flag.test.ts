import { describe, it, expect } from 'vitest';
import { AiGate, AiGateRefused, PauseFlagCache } from './ai-gate.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';
import { InMemoryAiPauseRepository } from '../../adapters/spend/in-memory-ai-pause-repository.js';

// [USAGE-ALLOWANCE · D14 runtime kill switch] A runtime pause (DB flag) takes effect at the gate within
// the cache window; the env-forced flag always pauses.
const WINDOW = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-10-01T00:00:00Z') };

function gate(pauseFlag: PauseFlagCache) {
  return new AiGate({
    allowance: new InMemoryAiAllowanceRepository(),
    allowanceAed: 40,
    alertThresholdAed: 300,
    billingWindowFor: async () => WINDOW,
    isPaused: () => pauseFlag.paused(),
    now: () => Date.parse('2026-10-10T00:00:00Z'),
  });
}

describe('[USAGE-ALLOWANCE · D14] runtime pause flag', () => {
  it('a runtime pause set after boot refuses the next call within the cache window — zero provider requests', async () => {
    const repo = new InMemoryAiPauseRepository();
    let clock = 0;
    const flag = new PauseFlagCache(repo, false, 30_000, () => clock);
    const g = gate(flag);

    // Not paused → a call runs.
    let calls = 0;
    const call = () => g.run({ userId: 'u', estimateAed: 1, exec: async () => { calls += 1; return { aed: 0.1 }; }, actualAedFrom: (r) => r.aed });
    await call();
    expect(calls).toBe(1);

    // Operator flips the DB flag at runtime.
    await repo.setPaused(true);
    // Within the cache window (<=30s) the gate picks it up; advance past the TTL to force the refresh.
    clock += 31_000;
    await expect(call()).rejects.toBeInstanceOf(AiGateRefused);
    expect(calls).toBe(1); // provider NOT called again
  });

  it('the AI_PAUSED env forces pause regardless of the DB flag', async () => {
    const repo = new InMemoryAiPauseRepository(); // DB says not paused
    const flag = new PauseFlagCache(repo, true, 30_000, () => 0); // envForced = true
    expect(await flag.paused()).toBe(true);
  });

  it('clearing the runtime flag re-allows calls after the window', async () => {
    const repo = new InMemoryAiPauseRepository();
    let clock = 0;
    const flag = new PauseFlagCache(repo, false, 30_000, () => clock);
    await repo.setPaused(true);
    expect(await flag.paused()).toBe(true);
    await repo.setPaused(false);
    clock += 31_000; // past the cache window
    expect(await flag.paused()).toBe(false);
  });
});
