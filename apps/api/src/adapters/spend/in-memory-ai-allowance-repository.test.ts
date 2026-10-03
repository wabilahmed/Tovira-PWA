import { describe, it, expect } from 'vitest';
import { InMemoryAiAllowanceRepository } from './in-memory-ai-allowance-repository.js';

// [USAGE-ALLOWANCE] Ledger semantics: atomic reserve, settle actual, release, expire stale, top-up
// raises available, top-up carries forward, global alert fires once.
const AED = 40;

async function seeded(): Promise<InMemoryAiAllowanceRepository> {
  const repo = new InMemoryAiAllowanceRepository();
  await repo.ensureMonth('u', 'm:2026-10', Date.parse('2026-10-01T00:00:00Z'), AED);
  return repo;
}

describe('[USAGE-ALLOWANCE] reserve / settle', () => {
  it('reserves within available and refuses once the headroom is gone', async () => {
    const repo = await seeded();
    const r1 = await repo.reserve('u', 'm:2026-10', 30, Date.now() + 60_000);
    expect(r1.ok).toBe(true);
    const r2 = await repo.reserve('u', 'm:2026-10', 20, Date.now() + 60_000); // 30+20 > 40
    expect(r2.ok).toBe(false);
    const m = (await repo.getMonth('u', 'm:2026-10'))!;
    expect(m.reservedAed).toBe(30);
    expect(m.spentAed).toBe(0);
  });

  it('settle releases the reservation and books the ACTUAL (freeing headroom the estimate locked)', async () => {
    const repo = await seeded();
    const r = await repo.reserve('u', 'm:2026-10', 10, Date.now() + 60_000); // worst-case estimate
    await repo.settle('u', r.reservationId!, 2); // actual was far less
    const m = (await repo.getMonth('u', 'm:2026-10'))!;
    expect(m.reservedAed).toBe(0);
    expect(m.spentAed).toBe(2);
    // Headroom is back to 40-2 = 38, so a 30 reserve now fits.
    expect((await repo.reserve('u', 'm:2026-10', 30, Date.now() + 60_000)).ok).toBe(true);
  });

  it('settle with zero cost (errored call) frees the estimate and books nothing', async () => {
    const repo = await seeded();
    const r = await repo.reserve('u', 'm:2026-10', 10, Date.now() + 60_000);
    await repo.settle('u', r.reservationId!, 0);
    const m = (await repo.getMonth('u', 'm:2026-10'))!;
    expect(m.reservedAed).toBe(0);
    expect(m.spentAed).toBe(0);
  });

  it('release frees a reservation without charging', async () => {
    const repo = await seeded();
    const r = await repo.reserve('u', 'm:2026-10', 10, Date.now() + 60_000);
    await repo.release('u', r.reservationId!);
    const m = (await repo.getMonth('u', 'm:2026-10'))!;
    expect(m.reservedAed).toBe(0);
    expect(m.spentAed).toBe(0);
  });
});

describe('[USAGE-ALLOWANCE] stale reservations', () => {
  it('expires open reservations past their expiry and frees their estimate', async () => {
    const repo = await seeded();
    await repo.reserve('u', 'm:2026-10', 15, 1_000); // expires at t=1000
    const expired = await repo.expireStale(2_000);
    expect(expired).toBe(1);
    const m = (await repo.getMonth('u', 'm:2026-10'))!;
    expect(m.reservedAed).toBe(0);
    // A settled reservation is not expired again.
    expect(await repo.expireStale(3_000)).toBe(0);
  });
});

describe('[USAGE-ALLOWANCE] top-ups', () => {
  it('a top-up raises available so a previously-refused reserve now fits (bar drops, D8)', async () => {
    const repo = await seeded();
    await repo.reserve('u', 'm:2026-10', 40, Date.now() + 60_000); // at 100%
    expect((await repo.reserve('u', 'm:2026-10', 10, Date.now() + 60_000)).ok).toBe(false);
    await repo.topUp('u', 'm:2026-10', 10); // +25% top-up
    expect((await repo.reserve('u', 'm:2026-10', 10, Date.now() + 60_000)).ok).toBe(true);
  });

  it('carries the remaining top-up forward to the next window; the monthly allowance resets', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    await repo.ensureMonth('u', 'm:2026-10', Date.parse('2026-10-01T00:00:00Z'), AED);
    await repo.topUp('u', 'm:2026-10', 20); // available 60
    // Spend 50: 40 of allowance + 10 of top-up → 10 top-up remains.
    const r = await repo.reserve('u', 'm:2026-10', 50, Date.now() + 60_000);
    await repo.settle('u', r.reservationId!, 50);
    const next = await repo.ensureMonth('u', 'm:2026-11', Date.parse('2026-11-01T00:00:00Z'), AED);
    expect(next.allowanceAed).toBe(40); // reset
    expect(next.topupAed).toBe(10); // carried remainder
    expect(next.spentAed).toBe(0);
  });
});

describe('[USAGE-ALLOWANCE] global alert record', () => {
  it('accumulates calendar-month spend and flags the crossing exactly once', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    const a = await repo.recordGlobal('2026-10', 200, 300);
    expect(a.crossedAlert).toBe(false);
    const b = await repo.recordGlobal('2026-10', 150, 300); // 200 -> 350 crosses 300
    expect(b.crossedAlert).toBe(true);
    expect(b.totalAed).toBe(350);
    const c = await repo.recordGlobal('2026-10', 50, 300); // already alerted
    expect(c.crossedAlert).toBe(false);
    expect(c.totalAed).toBe(400);
  });

  it('never blocks — recordGlobal only accumulates and reports (no refusal path)', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    const r = await repo.recordGlobal('2026-10', 10_000, 300);
    expect(r.totalAed).toBe(10_000); // recorded regardless of how far over
  });
});
