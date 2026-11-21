import { describe, it, expect } from 'vitest';
import { AiGate } from './ai-gate.js';
import { AllowanceStatusService } from './allowance-status.js';
import { OnboardingAllowance, ONBOARDING_ALLOWANCE_AED, ONBOARDING_DAYS, ONBOARDING_PERIOD_KEY, importAllowanceLine } from './onboarding-allowance.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';

/**
 * [P81-3 · owner, 21 Nov] A one-time AED 20 onboarding allowance, usable for imports in the account's first 14 days,
 * separate from the AED 45 monthly cap. An import call in the window draws on it first (reserved and settled exactly
 * like the monthly allowance, in the same ledger, under its own key); anything else, or an import after day 14 or once
 * it is spent, uses the month as before. The Subscription page shows "Import allowance: AED X left" (rounded down).
 */
const DAY = 86_400_000;
const CREATED = Date.parse('2026-11-01T09:00:00Z');
const WINDOW = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-11-01T00:00:00Z') };
function world(nowMs: number) {
  const repo = new InMemoryAiAllowanceRepository();
  const onboarding = new OnboardingAllowance({ allowance: repo, accountStartFor: async () => CREATED, now: () => nowMs });
  const gate = new AiGate({ allowance: repo, allowanceAed: 45, alertThresholdAed: 1000, billingWindowFor: async () => WINDOW as never, isPaused: () => false, now: () => nowMs, onboarding });
  const status = new AllowanceStatusService({ allowance: repo, allowanceAed: 45, billingWindowFor: async () => WINDOW as never, now: () => nowMs, onboarding });
  const call = (spendClass: string, est: number, actual: number) => gate.run({ userId: 'u', spendClass, estimateAed: est, exec: async () => actual, actualAedFrom: (a) => a });
  return { repo, onboarding, status, call };
}

describe('[P81-3] the onboarding allowance', () => {
  it('is AED 20 for 14 days, under its own key', () => {
    expect(ONBOARDING_ALLOWANCE_AED).toBe(20);
    expect(ONBOARDING_DAYS).toBe(14);
    expect(ONBOARDING_PERIOD_KEY).toBe('onboarding');
  });
  it('an import in the first 14 days is charged to it, not to the month', async () => {
    const w = world(CREATED + 2 * DAY);
    await w.call('import', 1.5, 0.4);
    const s = await w.status.status('u');
    expect(s.spentAed).toBe(0); // the month is untouched
    expect(s.importAllowanceLeftAed).toBeCloseTo(19.6, 6);
  });
  it('NEGATIVE: a non-import call in the window uses the month', async () => {
    const w = world(CREATED + 2 * DAY);
    await w.call('extraction', 1.5, 0.4);
    const s = await w.status.status('u');
    expect(s.spentAed).toBeCloseTo(0.4, 6);
    expect(s.importAllowanceLeftAed).toBe(20);
  });
  it('NEGATIVE: an import after day 14 uses the month, and the line is gone', async () => {
    const w = world(CREATED + 14 * DAY + 1);
    await w.call('import', 1.5, 0.4);
    const s = await w.status.status('u');
    expect(s.spentAed).toBeCloseTo(0.4, 6);
    expect(s.importAllowanceLeftAed).toBeNull();
  });
  it('once it cannot cover a call, the import falls to the month (never refused while the month has room)', async () => {
    const w = world(CREATED + DAY);
    for (let i = 0; i < 13; i++) await w.call('import', 1.5, 1.5); // 19.5 spent from the onboarding allowance
    await w.call('import', 1.5, 1.0); // 0.5 left there: not enough to reserve 1.5, so the month takes it
    const s = await w.status.status('u');
    expect(s.importAllowanceLeftAed).toBeCloseTo(0.5, 6);
    expect(s.spentAed).toBeCloseTo(1.0, 6);
  });
  it('the month being used up does not stop imports while the onboarding allowance has room', async () => {
    const w = world(CREATED + DAY);
    await w.call('extraction', 45, 45); // the month is spent
    expect(await w.status.isExhausted('u')).toBe(true);
    expect(await w.status.isExhausted('u', { forImport: true })).toBe(false);
    await expect(w.call('import', 1.5, 0.4)).resolves.toBe(0.4);
  });
  it('NEGATIVE: with no account start known, there is no onboarding allowance', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    const ob = new OnboardingAllowance({ allowance: repo, accountStartFor: async () => null, now: () => CREATED });
    expect(await ob.leftAed('u')).toBeNull();
  });
  it('the Subscription line, rounded down', () => {
    expect(importAllowanceLine(20)).toBe('Import allowance: AED 20 left');
    expect(importAllowanceLine(19.6)).toBe('Import allowance: AED 19 left');
    expect(importAllowanceLine(0.4)).toBe('Import allowance: AED 0 left');
    expect(importAllowanceLine(null)).toBeNull();
  });
});
