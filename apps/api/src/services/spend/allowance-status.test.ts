import { describe, it, expect } from 'vitest';
import { AllowanceStatusService } from './allowance-status.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';

// [USAGE-ALLOWANCE · D3/D8] The rep sees only a percentage: rounded down, never 100% until AI actually
// stops; a top-up drops the bar.
const WINDOW = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-10-01T00:00:00Z') };

function make(allowance: InMemoryAiAllowanceRepository, allowanceAed = 40) {
  return new AllowanceStatusService({ allowance, allowanceAed, billingWindowFor: async () => WINDOW, now: () => Date.parse('2026-10-10T00:00:00Z') });
}

async function seed(spent: number, topup = 0): Promise<InMemoryAiAllowanceRepository> {
  const repo = new InMemoryAiAllowanceRepository();
  await repo.ensureMonth('u', 'm:2026-10', WINDOW.periodStart, 40);
  if (topup) await repo.topUp('u', 'm:2026-10', topup);
  if (spent) { const r = await repo.reserve('u', 'm:2026-10', spent, Date.now() + 1000); await repo.settle('u', r.reservationId!, spent); }
  return repo;
}

describe('[USAGE-ALLOWANCE] allowance status', () => {
  it('rounds the percentage DOWN', async () => {
    const s = await make(await seed(25)).status('u'); // 25/40 = 62.5%
    expect(s.percentUsed).toBe(62);
  });

  it('never shows 100% until exhausted — a near-full account caps at 99%', async () => {
    const s = await make(await seed(39.9)).status('u'); // 99.75% but not exhausted
    expect(s.percentUsed).toBe(99);
    expect(s.exhausted).toBe(false);
  });

  it('shows 100% and exhausted when the allowance is fully consumed', async () => {
    const s = await make(await seed(40)).status('u');
    expect(s.exhausted).toBe(true);
    expect(s.percentUsed).toBe(100);
  });

  it('a top-up drops the bar below 100% and clears exhausted (D8)', async () => {
    const repo = await seed(40); // exhausted at 40/40
    await repo.topUp('u', 'm:2026-10', 10); // +25% -> available 50
    const s = await make(repo).status('u');
    expect(s.exhausted).toBe(false);
    expect(s.percentUsed).toBe(80); // 40/50
  });

  it('[sticky] a refused call pins the meter to 100% even though settled spend is below the allowance', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    await repo.ensureMonth('u', 'm:2026-10', WINDOW.periodStart, 40);
    // A big import worst-case estimate (50 > 40) is refused while settled spend is still 0.
    const refused = await repo.reserve('u', 'm:2026-10', 50, Date.now() + 1000);
    expect(refused.ok).toBe(false);
    const s = await make(repo).status('u');
    expect(s.spentAed).toBe(0); // nothing actually spent
    expect(s.exhausted).toBe(true); // but display is pinned
    expect(s.percentUsed).toBe(100);
    // A top-up clears it.
    await repo.topUp('u', 'm:2026-10', 20);
    const s2 = await make(repo).status('u');
    expect(s2.exhausted).toBe(false);
  });

  it('counts an in-flight reservation toward exhaustion (the stop is pre-call)', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    await repo.ensureMonth('u', 'm:2026-10', WINDOW.periodStart, 40);
    await repo.reserve('u', 'm:2026-10', 40, Date.now() + 1000); // reserved, not yet settled
    const s = await make(repo).status('u');
    expect(s.exhausted).toBe(true);
  });
});
