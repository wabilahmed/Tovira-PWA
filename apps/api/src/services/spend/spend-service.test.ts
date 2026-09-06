import { describe, it, expect } from 'vitest';
import { SpendService } from './spend-service.js';
import { InMemorySpendLedgerRepository } from '../../adapters/spend/in-memory-spend-ledger-repository.js';
import { InMemorySpendOverrideRepository } from '../../adapters/spend/in-memory-spend-override-repository.js';

const SONNET = 'claude-sonnet-5';
// A period key fixed for one rep so the test controls the window.
const period = async () => 'p:2026-09';

function make(capAed = 45, warnFraction = 0.8) {
  const ledger = new InMemorySpendLedgerRepository();
  const svc = new SpendService(ledger, period, { capAed, warnFraction });
  return { ledger, svc };
}

describe('[SPEND-CAP] SpendService — track (CAP-TRACK)', () => {
  it('records a Claude call as AED into the rep\'s current period', async () => {
    const { svc } = make();
    // 1,000,000 input tokens · Sonnet $3/MTok = $3 → ×3.6725 = AED 11.0175
    await svc.record('rep-A', 'extraction', SONNET, { inputTokens: 1_000_000, outputTokens: 0 });
    const s = await svc.status('rep-A');
    expect(s.spentAed).toBeCloseTo(11.0175, 3);
    expect(s.periodKey).toBe('p:2026-09');
  });

  it('sums across cost classes and reports the dominant one', async () => {
    const { svc } = make();
    await svc.recordAed('rep-A', 'recall', 5);
    await svc.recordAed('rep-A', 'extraction', 20);
    await svc.recordAed('rep-A', 'import', 3);
    const s = await svc.status('rep-A');
    expect(s.spentAed).toBeCloseTo(28, 6);
    expect(s.dominantClass).toBe('extraction');
  });

  it('state is ok below 80%, warn at/above 80%, capped at/above 100%', async () => {
    const { svc } = make(45, 0.8);
    await svc.recordAed('rep-A', 'extraction', 30); // 30/45 = 66% → ok
    expect((await svc.status('rep-A')).state).toBe('ok');
    await svc.recordAed('rep-A', 'extraction', 7); // 37/45 = 82% → warn
    expect((await svc.status('rep-A')).state).toBe('warn');
    await svc.recordAed('rep-A', 'extraction', 8); // 45/45 = 100% → capped
    expect((await svc.status('rep-A')).state).toBe('capped');
  });

  it('canSpend is false only once capped', async () => {
    const { svc } = make(45);
    await svc.recordAed('rep-A', 'extraction', 44.99);
    expect(await svc.canSpend('rep-A')).toBe(true);
    await svc.recordAed('rep-A', 'extraction', 0.01);
    expect(await svc.canSpend('rep-A')).toBe(false);
  });

  it('never records embedding/transcription (only the caller\'s Claude classes) and ignores zero cost', async () => {
    const { svc, ledger } = make();
    await svc.record('rep-A', 'extraction', SONNET, { inputTokens: 0, outputTokens: 0 });
    expect((await ledger.getForPeriod('rep-A', 'p:2026-09')).totalAed).toBe(0);
  });

  it('isolates reps — one rep\'s spend never counts against another', async () => {
    const { svc } = make(45);
    await svc.recordAed('rep-A', 'extraction', 50);
    expect((await svc.status('rep-B')).spentAed).toBe(0);
    expect(await svc.canSpend('rep-B')).toBe(true);
  });
});

describe('[SPEND-CAP] SpendService — the 80% warn (CAP-WARN)', () => {
  function makeWarn(capAed = 45, warnFraction = 0.8) {
    const ledger = new InMemorySpendLedgerRepository();
    const warns: Array<{ userId: string; periodKey: string; spentAed: number; capAed: number; dominantClass: string | null }> = [];
    const svc = new SpendService(ledger, period, { capAed, warnFraction }, () => 0, undefined, async (e) => { warns.push(e); });
    return { svc, warns };
  }

  it('fires exactly once, on the call that first crosses the warn line', async () => {
    const { svc, warns } = makeWarn(45, 0.8); // warn at 36
    await svc.recordAed('rep-A', 'extraction', 30); // below → no warn
    expect(warns).toHaveLength(0);
    await svc.recordAed('rep-A', 'extraction', 8); // 38 ≥ 36 → the crossing call
    expect(warns).toHaveLength(1);
    await svc.recordAed('rep-A', 'recall', 5); // already over → no re-fire
    expect(warns).toHaveLength(1);
  });

  it('the warn names the rep, spend, period and dominant cost class', async () => {
    const { svc, warns } = makeWarn(45, 0.8);
    await svc.recordAed('rep-A', 'import', 40); // crosses in one go; import dominates
    expect(warns[0]).toMatchObject({ userId: 'rep-A', periodKey: 'p:2026-09', dominantClass: 'import' });
    expect(warns[0]!.spentAed).toBeCloseTo(40, 6);
    expect(warns[0]!.capAed).toBe(45);
  });

  it('does not fire when spend stays below the warn line', async () => {
    const { svc, warns } = makeWarn(45, 0.8);
    await svc.recordAed('rep-A', 'recall', 35);
    expect(warns).toHaveLength(0);
    expect((await svc.status('rep-A')).state).toBe('ok');
  });
});

describe('[SPEND-CAP] SpendService honours a per-account override (CAP-OVERRIDE)', () => {
  function makeOverride() {
    const ledger = new InMemorySpendLedgerRepository();
    const overrides = new InMemorySpendOverrideRepository();
    const svc = new SpendService(ledger, period, { capAed: 45, warnFraction: 0.8 }, () => 0, (u, pk) => overrides.effectiveCap(u, pk));
    return { svc, overrides };
  }

  it('a capped rep becomes uncapped when ops raises the cap for the period', async () => {
    const { svc, overrides } = makeOverride();
    await svc.recordAed('rep-A', 'import', 50); // over the 45 cap
    expect(await svc.canSpend('rep-A')).toBe(false);
    await overrides.set({ userId: 'rep-A', periodKey: 'p:2026-09', capAed: 90, raisedBy: 'ops', reason: 'onboarding a large brokerage' });
    expect(await svc.canSpend('rep-A')).toBe(true); // released — the queue can drain
    expect((await svc.status('rep-A')).capAed).toBe(90);
  });

  it('the override is scoped to the period it was set for', async () => {
    const { svc, overrides } = makeOverride();
    await overrides.set({ userId: 'rep-A', periodKey: 'other-period', capAed: 200, raisedBy: 'ops', reason: 'x' });
    await svc.recordAed('rep-A', 'import', 50);
    expect(await svc.canSpend('rep-A')).toBe(false); // this period still uses the config cap
  });
});
