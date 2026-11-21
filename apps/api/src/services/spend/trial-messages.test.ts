import { describe, it, expect } from 'vitest';
import { loadConfig, TRIAL_MESSAGES } from '../../config.js';
import { AllowanceStatusService } from './allowance-status.js';
import { AiGate, AiGateRefused } from './ai-gate.js';
import { SpendService } from './spend-service.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';
import { InMemorySpendLedgerRepository } from '../../adapters/spend/in-memory-spend-ledger-repository.js';

/**
 * [P84-5 · owner, 22 Nov] "Trials: 5,000 messages for the 14-day trial (not 10,000). Match the trial failsafe to the
 * trial gate." The trial's money gate is the same AED per message as the plan (AED 60 per 10,000), so 5,000 messages
 * = AED 30, and the trial ledger failsafe flags at that same line (it was AED 20).
 */
const base = { DATABASE_URL: 'postgres://t:t@localhost:5432/t' };
const TRIAL_END = Date.parse('2026-11-30T00:00:00Z');
const NOW = Date.parse('2026-11-20T00:00:00Z');
const TRIAL = { status: 'trialing', trialEndsAt: TRIAL_END, renewsAt: null, periodStart: null };
const ACTIVE = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-11-01T00:00:00Z') };

describe('[P84-5] the trial: 5,000 messages, and its gate and failsafe agree', () => {
  it('config: 5,000 trial messages, a trial gate of AED 30, and the trial failsafe at the same AED 30', () => {
    const c = loadConfig(base);
    expect(TRIAL_MESSAGES).toBe(5000);
    expect(c.trialMessages).toBe(5000);
    expect(c.trialAiAllowanceAed).toBe(30);
    expect(c.trialSpendCapAed).toBe(c.trialAiAllowanceAed);
  });
  it('the failsafe follows the trial gate when the gate is configured', () => {
    const c = loadConfig({ ...base, TRIAL_MESSAGES: '4000' });
    expect(c.trialAiAllowanceAed).toBe(24);
    expect(c.trialSpendCapAed).toBe(24);
  });
  it('NEGATIVE: the paid plan is unchanged (10,000 messages, AED 60, failsafe 60)', () => {
    const c = loadConfig(base);
    expect([c.monthlyMessages, c.monthlyAiAllowanceAed, c.spendCapAed]).toEqual([10_000, 60, 60]);
  });

  const svc = (repo: InMemoryAiAllowanceRepository, win: typeof TRIAL | typeof ACTIVE) => new AllowanceStatusService({
    allowance: repo, allowanceAed: 60, messagesAllowance: 10_000, trialAllowanceAed: 30, trialMessagesAllowance: 5000, billingWindowFor: async () => win, now: () => NOW,
  });
  it('a trialing rep has 5,000 messages and an AED 30 gate', async () => {
    const s = await svc(new InMemoryAiAllowanceRepository(), TRIAL).status('u');
    expect([s.messagesAllowance, s.messagesLeft, s.allowanceAed]).toEqual([5000, 5000, 30]);
  });
  it('NEGATIVE: a chat bigger than the trial has left does not run', async () => {
    const s = svc(new InMemoryAiAllowanceRepository(), TRIAL);
    expect(await s.chargeMessages('u', 'a', 4800)).toBe(true);
    expect(await s.chargeMessages('u', 'b', 300)).toBe(false);
  });
  it('NEGATIVE: a subscriber still has 10,000 and AED 60', async () => {
    const s = await svc(new InMemoryAiAllowanceRepository(), ACTIVE).status('u');
    expect([s.messagesAllowance, s.allowanceAed]).toEqual([10_000, 60]);
  });
  it('the gate, if it opens the trial window first, opens it with the trial figures too', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    const gate = new AiGate({ allowance: repo, allowanceAed: 60, trialAllowanceAed: 30, trialMessagesAllowance: 5000, alertThresholdAed: 1000, billingWindowFor: async () => TRIAL as never, isPaused: () => false, now: () => NOW });
    await gate.run({ userId: 'u', estimateAed: 1, exec: async () => 0.5, actualAedFrom: (a) => a });
    const s = await svc(repo, TRIAL).status('u');
    expect([s.messagesAllowance, s.allowanceAed]).toEqual([5000, 30]);
    await expect(gate.run({ userId: 'u', estimateAed: 30, exec: async () => 1, actualAedFrom: (a) => a })).rejects.toBeInstanceOf(AiGateRefused);
  });
  it('the trial failsafe flags at the trial gate line', async () => {
    const c = loadConfig(base);
    const spend = new SpendService(new InMemorySpendLedgerRepository(), async () => 't:123', { capAed: c.spendCapAed, trialCapAed: c.trialSpendCapAed, warnFraction: 0.8 }, () => 0);
    expect((await spend.status('u')).capAed).toBe(30);
  });
});
