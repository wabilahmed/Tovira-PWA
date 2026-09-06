import type { SpendLedgerRepository, SpendClass } from '../../ports/spend-ledger-repository.js';
import { callCostUsd, USD_TO_AED, type CallUsage } from '../metrics/model-budget.js';

export type SpendState = 'ok' | 'warn' | 'capped';

export interface SpendStatus {
  periodKey: string;
  spentAed: number;
  capAed: number;
  fraction: number;
  state: SpendState;
  dominantClass: SpendClass | null;
}

/** Resolve a rep's current BILLING-period key (so the cap window matches the invoice window). */
export type PeriodKeyFor = (userId: string, nowMs: number) => Promise<string>;

/** Notified when a rep first crosses the warn threshold in a period (CAP-WARN). Idempotency is the
 *  handler's concern (one ops alert per rep per period). */
export type WarnHandler = (e: { userId: string; periodKey: string; spentAed: number; capAed: number; dominantClass: SpendClass | null }) => Promise<void>;

/** Per-account override of the cap for a period (CAP-OVERRIDE). Returns null → the config cap holds. */
export type OverrideFor = (userId: string, periodKey: string) => Promise<number | null>;

/**
 * [SPEND-CAP] The per-account Claude-spend failsafe. Accumulates real AED per rep per billing period
 * (durable), reports how close a rep is to the cap, and answers `canSpend` for the enforcement gate.
 * A hard ceiling protects against a runaway rep or a defect costing more than the account earns;
 * enforcement DEGRADES rather than blocks (see the sweep/recall gates) — this service only measures
 * and classifies. Embeddings and transcription are not Claude spend and are never recorded here.
 */
export class SpendService {
  constructor(
    private readonly ledger: SpendLedgerRepository,
    private readonly periodKeyFor: PeriodKeyFor,
    private readonly cfg: { capAed: number; warnFraction: number },
    private readonly now: () => number = () => Date.now(),
    /** CAP-OVERRIDE: raises the cap for a named rep+period. Optional. */
    private readonly overrideFor?: OverrideFor,
    /** CAP-WARN: fired the first time a rep crosses the warn line in a period. Optional. */
    private readonly onWarn?: WarnHandler,
  ) {}

  /** Record a real Claude call's cost (computed from usage). Zero-cost calls are ignored. */
  async record(userId: string, costClass: SpendClass, model: string, usage: CallUsage): Promise<void> {
    await this.recordAed(userId, costClass, callCostUsd(model, usage) * USD_TO_AED);
  }

  /** Record a pre-computed AED cost (e.g. a summed multi-call import). */
  async recordAed(userId: string, costClass: SpendClass, aed: number): Promise<void> {
    if (!(aed > 0)) return;
    const periodKey = await this.periodKeyFor(userId, this.now());
    const before = (await this.ledger.getForPeriod(userId, periodKey)).totalAed;
    await this.ledger.add(userId, periodKey, costClass, aed);
    // CAP-WARN: fire once, on the call that first crosses the warn line (before < warn ≤ after).
    if (this.onWarn) {
      const capAed = (await this.overrideFor?.(userId, periodKey)) ?? this.cfg.capAed;
      const warnAt = capAed * this.cfg.warnFraction;
      const after = before + aed;
      if (before < warnAt && after >= warnAt) {
        const spend = await this.ledger.getForPeriod(userId, periodKey);
        await this.onWarn({ userId, periodKey, spentAed: spend.totalAed, capAed, dominantClass: dominant(spend.byClass) });
      }
    }
  }

  /** The rep's spend state for their current period. */
  async status(userId: string): Promise<SpendStatus> {
    const periodKey = await this.periodKeyFor(userId, this.now());
    const spend = await this.ledger.getForPeriod(userId, periodKey);
    const capAed = (await this.overrideFor?.(userId, periodKey)) ?? this.cfg.capAed;
    const fraction = capAed > 0 ? spend.totalAed / capAed : 0;
    const state: SpendState = spend.totalAed >= capAed ? 'capped' : fraction >= this.cfg.warnFraction ? 'warn' : 'ok';
    return { periodKey, spentAed: spend.totalAed, capAed, fraction, state, dominantClass: dominant(spend.byClass) };
  }

  /** The enforcement predicate: false only once the rep is capped. */
  async canSpend(userId: string): Promise<boolean> {
    return (await this.status(userId)).state !== 'capped';
  }

  /** Compact cap config for /health (ops watches this next to the rolling cost metrics). */
  snapshot(): { capAed: number; warnFraction: number } {
    return { capAed: this.cfg.capAed, warnFraction: this.cfg.warnFraction };
  }
}

function dominant(byClass: Array<{ costClass: SpendClass; aed: number }>): SpendClass | null {
  if (byClass.length === 0) return null;
  return byClass.reduce((a, b) => (b.aed > a.aed ? b : a)).costClass;
}
