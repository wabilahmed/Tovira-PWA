import type { AiAllowanceRepository } from '../../ports/ai-allowance-repository.js';
import { allowanceWindow, type AllowanceWindowInput } from './ai-period.js';

/**
 * [USAGE-ALLOWANCE] The rep-facing allowance status (D3/D4/D8) and the pre-call "is AI stopped?" check.
 * The rep ever sees ONLY a percentage (D3): rounded DOWN, and never 100% until AI has actually stopped.
 * `exhausted` is the stop state: no headroom remains for even the next call, so import/questions/jobs
 * refuse up front instead of calling a model to discover it.
 */
export interface AllowanceStatus {
  allowanceAed: number;
  topupAed: number;
  spentAed: number;
  reservedAed: number;
  availableAed: number;
  /** Whole-percent used, rounded DOWN; capped at 99 until `exhausted` (D3). */
  percentUsed: number;
  /** True when spent + reserved leaves no headroom — AI features stop (D4). */
  exhausted: boolean;
}

export interface AllowanceStatusDeps {
  allowance: AiAllowanceRepository;
  allowanceAed: number;
  billingWindowFor: (userId: string) => Promise<AllowanceWindowInput>;
  now?: () => number;
}

// Floating-point slack: treat headroom within a thousandth of a fil as gone.
const EPS = 1e-6;

export class AllowanceStatusService {
  private readonly now: () => number;
  constructor(private readonly deps: AllowanceStatusDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async status(userId: string): Promise<AllowanceStatus> {
    const w = allowanceWindow(await this.deps.billingWindowFor(userId), this.now());
    const m = await this.deps.allowance.ensureMonth(userId, w.key, w.startMs, this.deps.allowanceAed);
    const availableAed = m.allowanceAed + m.topupAed;
    // [sticky] a prior refusal pins exhaustion even if settled spend is below the allowance.
    const exhausted = m.displayExhausted || m.spentAed + m.reservedAed >= availableAed - EPS;
    const rawPct = availableAed <= 0 ? 100 : Math.floor((m.spentAed / availableAed) * 100);
    // Never show 100% until the stop has actually happened (D3).
    const percentUsed = exhausted ? 100 : Math.min(99, Math.max(0, rawPct));
    return {
      allowanceAed: m.allowanceAed,
      topupAed: m.topupAed,
      spentAed: m.spentAed,
      reservedAed: m.reservedAed,
      availableAed,
      percentUsed,
      exhausted,
    };
  }

  /** The pre-call gate used by import/questions/jobs: has this rep's AI stopped? */
  async isExhausted(userId: string): Promise<boolean> {
    return (await this.status(userId)).exhausted;
  }
}
