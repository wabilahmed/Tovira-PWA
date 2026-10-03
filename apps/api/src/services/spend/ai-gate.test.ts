import { describe, it, expect } from 'vitest';
import { AiGate, AiGateRefused } from './ai-gate.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';

// [USAGE-ALLOWANCE · Task 3] The gate: kill switch, account-only reservation, settle actual, release on
// error, one-shot global alert, ownerless calls skip the reservation but still record + respect pause.
const WINDOW = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-10-01T00:00:00Z') };

function makeGate(opts: { paused?: boolean; allowanceAed?: number; alert?: number; onAlert?: (ym: string, t: number) => void } = {}) {
  const allowance = new InMemoryAiAllowanceRepository();
  const gate = new AiGate({
    allowance,
    allowanceAed: opts.allowanceAed ?? 40,
    alertThresholdAed: opts.alert ?? 300,
    billingWindowFor: async () => WINDOW,
    isPaused: () => opts.paused ?? false,
    onAlert: opts.onAlert,
    now: () => Date.parse('2026-10-10T00:00:00Z'),
  });
  return { gate, allowance };
}

describe('[GATE] kill switch (D14)', () => {
  it('refuses with kill_switch and makes NO provider call when paused', async () => {
    const { gate } = makeGate({ paused: true });
    let called = false;
    await expect(
      gate.run({ userId: 'u', estimateAed: 1, exec: async () => { called = true; return { aed: 0 }; }, actualAedFrom: (r) => r.aed }),
    ).rejects.toBeInstanceOf(AiGateRefused);
    expect(called).toBe(false);
  });

  it('an exempt call (erasure) runs even when paused', async () => {
    const { gate } = makeGate({ paused: true });
    let called = false;
    const r = await gate.run({ userId: null, estimateAed: 0, exemptFromPause: true, exec: async () => { called = true; return { aed: 0.1 }; }, actualAedFrom: (x) => x.aed });
    expect(called).toBe(true);
    expect(r.aed).toBe(0.1);
  });
});

describe('[GATE] account reservation', () => {
  it('refuses with account_limit when the estimate would exceed the allowance, before the call', async () => {
    const { gate, allowance } = makeGate({ allowanceAed: 5 });
    let called = false;
    await expect(
      gate.run({ userId: 'u', estimateAed: 6, exec: async () => { called = true; return { aed: 6 }; }, actualAedFrom: (r) => r.aed }),
    ).rejects.toMatchObject({ reason: 'account_limit' });
    expect(called).toBe(false); // refused BEFORE the provider
    const m = await allowance.getMonth('u', 'm:2026-10');
    expect(m!.reservedAed).toBe(0); // the failed reservation left nothing behind
  });

  it('settles the ACTUAL (not the worst-case estimate) after a successful call', async () => {
    const { gate, allowance } = makeGate();
    await gate.run({ userId: 'u', estimateAed: 10, exec: async () => ({ aed: 2 }), actualAedFrom: (r) => r.aed });
    const m = (await allowance.getMonth('u', 'm:2026-10'))!;
    expect(m.reservedAed).toBe(0);
    expect(m.spentAed).toBe(2);
  });

  it('releases the reservation (charges nothing) when the call throws', async () => {
    const { gate, allowance } = makeGate();
    await expect(
      gate.run({ userId: 'u', estimateAed: 10, exec: async () => { throw new Error('provider 500'); }, actualAedFrom: () => 0 }),
    ).rejects.toThrow('provider 500');
    const m = (await allowance.getMonth('u', 'm:2026-10'))!;
    expect(m.reservedAed).toBe(0);
    expect(m.spentAed).toBe(0);
  });
});

describe('[GATE] global record + alert (D13)', () => {
  it('records actual spend globally and fires the alert exactly once, never refusing', async () => {
    const alerts: number[] = [];
    const { gate } = makeGate({ alert: 5, onAlert: (_ym, t) => alerts.push(t) });
    await gate.run({ userId: 'u', estimateAed: 10, exec: async () => ({ aed: 3 }), actualAedFrom: (r) => r.aed }); // total 3
    await gate.run({ userId: 'u', estimateAed: 10, exec: async () => ({ aed: 4 }), actualAedFrom: (r) => r.aed }); // total 7 crosses 5
    await gate.run({ userId: 'u', estimateAed: 10, exec: async () => ({ aed: 4 }), actualAedFrom: (r) => r.aed }); // total 11, already alerted
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toBe(7);
  });

  it('an ownerless call skips the per-account reservation but still records globally', async () => {
    const alerts: number[] = [];
    const { gate, allowance } = makeGate({ alert: 1, onAlert: (_ym, t) => alerts.push(t) });
    await gate.run({ userId: null, estimateAed: 0, exec: async () => ({ aed: 2 }), actualAedFrom: (r) => r.aed });
    expect(alerts).toEqual([2]); // recorded + alerted
    expect(await allowance.getMonth('u', 'm:2026-10')).toBeNull(); // no per-account row touched
  });
});
