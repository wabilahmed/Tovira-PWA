import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AiGate } from './ai-gate.js';
import { AllowanceStatusService } from './allowance-status.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';

/**
 * [P82-A · owner, 21 Nov] The one-time AED 20 onboarding allowance (P81-3, d74cfa2) is removed: "the extra-purchase
 * mechanism covers reps who need more". An import in an account's first days is charged to the month like any call,
 * the status carries no import-allowance figure, and the module is gone.
 */
const NOW = Date.parse('2026-11-02T09:00:00Z');
const WINDOW = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-11-01T00:00:00Z') };
describe('[P82-A] no onboarding allowance', () => {
  it('a first-week import is charged to the month', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    const gate = new AiGate({ allowance: repo, allowanceAed: 45, alertThresholdAed: 1000, billingWindowFor: async () => WINDOW as never, isPaused: () => false, now: () => NOW });
    const status = new AllowanceStatusService({ allowance: repo, allowanceAed: 45, billingWindowFor: async () => WINDOW as never, now: () => NOW });
    await gate.run({ userId: 'u', estimateAed: 1.5, exec: async () => 0.4, actualAedFrom: (a) => a });
    const s = await status.status('u');
    expect(s.spentAed).toBeCloseTo(0.4, 6);
    expect(s).not.toHaveProperty('importAllowanceLeftAed');
  });
  it('the onboarding module is gone', () => {
    expect(existsSync(fileURLToPath(new URL('./onboarding-allowance.ts', import.meta.url)))).toBe(false);
  });
});
