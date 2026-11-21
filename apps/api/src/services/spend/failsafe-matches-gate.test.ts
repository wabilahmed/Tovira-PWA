import { describe, it, expect } from 'vitest';
import { SpendService } from './spend-service.js';
import { InMemorySpendLedgerRepository } from '../../adapters/spend/in-memory-spend-ledger-repository.js';
import { loadConfig } from '../../config.js';

/**
 * [P83 · owner, 21 Nov] "The real limit is the AED 60 gate: keep it; set the AED 45 ledger failsafe to match whatever
 * stops imports." The failsafe now flags at the gate's own line: AED 60 a month plus the AED headroom the rep's packs
 * added to the gate. The trial failsafe is unchanged.
 */
const base = { DATABASE_URL: 'postgres://t:t@localhost:5432/t' };

describe('[P83] the ledger failsafe matches the gate', () => {
  it('the default failsafe is the gate allowance (AED 60), not 45', () => {
    const c = loadConfig(base);
    expect(c.spendCapAed).toBe(60);
    expect(c.spendCapAed).toBe(c.monthlyAiAllowanceAed);
  });
  it('a pack raises the failsafe by the same AED it added to the gate', async () => {
    const svc = new SpendService(new InMemorySpendLedgerRepository(), async () => 'p:2026-11', { capAed: 60, warnFraction: 0.8 }, () => 0, undefined, undefined, async () => 9);
    await svc.recordAed('u', 'extraction', 65);
    const s = await svc.status('u');
    expect([s.capAed, s.state]).toEqual([69, 'warn']);
  });
  it('NEGATIVE: with no pack the failsafe flags at AED 60', async () => {
    const svc = new SpendService(new InMemorySpendLedgerRepository(), async () => 'p:2026-11', { capAed: 60, warnFraction: 0.8 }, () => 0, undefined, undefined, async () => 0);
    await svc.recordAed('u', 'extraction', 60);
    expect((await svc.status('u')).state).toBe('capped');
  });
  it('NEGATIVE: a trial period keeps the trial failsafe, packs or not', async () => {
    const svc = new SpendService(new InMemorySpendLedgerRepository(), async () => 't:123', { capAed: 60, trialCapAed: 20, warnFraction: 0.8 }, () => 0, undefined, undefined, async () => 9);
    expect((await svc.status('u')).capAed).toBe(20);
  });
});
