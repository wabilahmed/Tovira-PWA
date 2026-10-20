import { describe, it, expect } from 'vitest';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';
import { AllowanceStatusService } from './allowance-status.js';
import type { AllowanceWindowInput } from './ai-period.js';

/**
 * [P37 · owner, 20 Oct] Top-up credit never expires. The monthly allowance is used FIRST; the balance only once
 * the month is at 100%. The month resets each billing month; the balance never resets — through any number of
 * periods, and through a lapse and a resubscribe. The 80/95/100% figures count month + balance together.
 * "Extra usage: +N% left" is the remaining balance as a share of the monthly allowance.
 */
const U = 'u-bal';
const ALLOWANCE = 60;
function setup(start = Date.UTC(2026, 9, 5)) {
  const repo = new InMemoryAiAllowanceRepository();
  let now = start;
  let win: AllowanceWindowInput = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: start };
  const svc = new AllowanceStatusService({ allowance: repo, allowanceAed: ALLOWANCE, billingWindowFor: async () => win, now: () => now });
  const key = async () => { const s = await svc.status(U); void s; return (await import('./ai-period.js')).allowanceWindow(win, now); };
  const spend = async (aed: number) => {
    const w = await key();
    const r = await repo.reserve(U, w.key, aed, now + 60_000);
    if (!r.ok) throw new Error('refused');
    await repo.settle(U, r.reservationId!, aed);
  };
  const topUp = async (aed: number) => { const w = await key(); await repo.topUp(U, w.key, aed); };
  return { svc, spend, topUp, setNow: (t: number) => { now = t; }, setWin: (w: AllowanceWindowInput) => { win = w; } };
}

describe('[P37] the top-up balance', () => {
  it('the monthly allowance is used before the balance', async () => {
    const b = setup();
    await b.topUp(30); // +50%
    await b.spend(50); // inside the month
    expect((await b.svc.status(U)).extraPercentLeft).toBe(50); // balance untouched
    await b.spend(20); // 10 more than the month → from the balance
    expect((await b.svc.status(U)).extraPercentLeft).toBe(33); // 20 of 60 left → 33%
  });

  it('survives a month reset and several billing periods', async () => {
    const b = setup();
    await b.topUp(30);
    for (let month = 1; month <= 4; month += 1) {
      b.setNow(Date.UTC(2026, 9 + month, 6));
      const s = await b.svc.status(U);
      expect([month, s.extraPercentLeft, s.topupAed]).toEqual([month, 50, 30]);
    }
  });

  it('survives a lapse and a resubscribe (the balance waits on the account)', async () => {
    const b = setup();
    await b.topUp(30);
    // Lapsed for two months: no window is touched while unsubscribed.
    b.setNow(Date.UTC(2027, 0, 15));
    b.setWin({ status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.UTC(2027, 0, 15) }); // resubscribed
    expect((await b.svc.status(U)).extraPercentLeft).toBe(50);
  });

  it('the 80% figure counts month + balance together (no warning at 80% of the month alone)', async () => {
    const b = setup();
    await b.topUp(60); // +100%
    await b.spend(50); // 83% of the month
    expect((await b.svc.status(U)).percentUsed).toBe(41); // 50 of 120
  });
});
