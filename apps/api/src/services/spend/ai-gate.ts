import type { AiAllowanceRepository } from '../../ports/ai-allowance-repository.js';
import type { AiPauseRepository } from '../../ports/ai-pause-repository.js';
import { allowanceWindow, type AllowanceWindowInput } from './ai-period.js';

/**
 * [USAGE-ALLOWANCE · D14 runtime kill switch] Reads the DB pause flag with a cache of at most `ttlMs`
 * (default 30s), so the gate stays fast but a runtime pause takes effect within the window. The
 * `envForced` boot flag (AI_PAUSED env) forces pause ON regardless of the DB. On a read error the last
 * known value is kept (fail to the last-good state, never crash a call).
 */
export class PauseFlagCache {
  private cached = false;
  private at = -Infinity;
  constructor(
    private readonly repo: AiPauseRepository,
    private readonly envForced = false,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = () => Date.now(),
  ) {}
  async paused(): Promise<boolean> {
    if (this.envForced) return true;
    if (this.now() - this.at >= this.ttlMs) {
      try { this.cached = await this.repo.getPaused(); this.at = this.now(); } catch { /* keep last good */ }
    }
    return this.cached;
  }
}

/**
 * [USAGE-ALLOWANCE · Task 3] THE GATE. Every paid model call goes through `run()`. Nothing else may
 * reach a provider. A single rep's account can never run up an AI bill beyond its allowance, and no bug
 * can either, because the reservation is taken BEFORE the call and is atomic.
 *
 * Before the call: refuse if the kill switch is on (except an exempt call); estimate the WORST-CASE cost;
 * reserve it atomically against the account's own allowance (account-only — there is no global
 * reservation and no cross-account ceiling). After the call: settle the ACTUAL cost and record it in the
 * global monthly total for the email alert (which never blocks).
 *
 * OWNERLESS calls (the canary, erasure re-summarisation) have no account, so the per-account reservation
 * is skipped — but they still pass through the gate (kill-switch check + global record), so the
 * "no ungated provider calls" guard still covers them.
 */

/** Why a call was refused BEFORE reaching the provider. */
export type GateRefusalReason = 'account_limit' | 'kill_switch';

export class AiGateRefused extends Error {
  override name = 'AiGateRefused';
  constructor(readonly reason: GateRefusalReason) {
    super(`AI call refused: ${reason}`);
  }
}

/**
 * The longest legitimate single call is a 2-attempt WhatsApp-import extraction at EXTRACTION_MAX_TOKENS;
 * each attempt is bounded by the model-fetch timeout (~60s) so a real call finishes within ~2 minutes.
 * 5 minutes sits safely above that and far above the ~15s sweep interval, so the stale-reservation sweep
 * frees a crashed call's reservation promptly WITHOUT ever expiring one that is still running.
 */
export const AI_RESERVATION_TTL_MS = 5 * 60 * 1000;

export interface AiGateDeps {
  allowance: AiAllowanceRepository;
  /** The monthly allowance (D1), in AED. */
  allowanceAed: number;
  /** The global email-alert threshold (D13), in AED. */
  alertThresholdAed: number;
  /** The rep's billing window, to derive the monthly allowance period. */
  billingWindowFor: (userId: string) => Promise<AllowanceWindowInput>;
  /** The manual kill switch (D14). May be async (it reads the cached runtime flag). */
  isPaused: () => boolean | Promise<boolean>;
  /** Fired ONCE when the global monthly total crosses the alert threshold. */
  onAlert?: (ym: string, totalAed: number) => void | Promise<void>;
  now?: () => number;
  reservationTtlMs?: number;
}

export interface GateCall<T> {
  /** The rep's id, or null for an ownerless system/legal call (canary, erasure). */
  userId: string | null;
  /** Worst-case cost of this call, AED. Never below the real cost (guaranteed by the estimators). */
  estimateAed: number;
  /** True ONLY for the erasure re-summarisation (a legal obligation) — exempt from the kill switch. */
  exemptFromPause?: boolean;
  /** [RULING 2] An already-started operation (a bulk chat past its start-gate) that must not be refused
   *  for the allowance. If there is room it reserves/charges normally; if not, it runs anyway and its
   *  overshoot is recorded globally but NOT charged to the account (absorbed). Kill switch still applies. */
  forceReserve?: boolean;
  /** The provider call itself. */
  exec: () => Promise<T>;
  /** The EXACT cost of the call, AED, from its result. */
  actualAedFrom: (result: T) => number;
}

export class AiGate {
  private readonly now: () => number;
  private readonly ttl: number;
  constructor(private readonly deps: AiGateDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.ttl = deps.reservationTtlMs ?? AI_RESERVATION_TTL_MS;
  }

  async run<T>(call: GateCall<T>): Promise<T> {
    // 1. Kill switch — refuse before anything, unless this call is exempt (erasure).
    if (!call.exemptFromPause && (await this.deps.isPaused())) throw new AiGateRefused('kill_switch');

    // 2–4. Reserve the worst case against the account's OWN allowance (ownerless calls skip this).
    let reservationId: string | null = null;
    if (call.userId) {
      const w = allowanceWindow(await this.deps.billingWindowFor(call.userId), this.now());
      await this.deps.allowance.ensureMonth(call.userId, w.key, w.startMs, this.deps.allowanceAed);
      const r = await this.deps.allowance.reserve(call.userId, w.key, call.estimateAed, this.now() + this.ttl);
      if (!r.ok) {
        // [RULING 2] An already-started chat is never refused for the allowance. With no reservation
        // its actual is left OUT of the per-user settle below (reservationId stays null) — absorbed, so
        // it can't eat a later top-up or carry forward — but it is still recorded globally for cost.
        if (!call.forceReserve) throw new AiGateRefused('account_limit');
      } else {
        reservationId = r.reservationId!;
      }
    }

    // 5–7. Run the call, then settle the ACTUAL (or release on error — the provider charged nothing we
    // can see), and record the spend in the global monthly total for the alert.
    let result: T;
    try {
      result = await call.exec();
    } catch (err) {
      if (call.userId && reservationId) await safe(() => this.deps.allowance.release(call.userId!, reservationId!));
      throw err;
    }
    const actual = Math.max(0, call.actualAedFrom(result));
    if (call.userId && reservationId) await safe(() => this.deps.allowance.settle(call.userId!, reservationId!, actual));
    if (actual > 0) {
      const ym = new Date(this.now()).toISOString().slice(0, 7);
      const g = await safeVal(() => this.deps.allowance.recordGlobal(ym, actual, this.deps.alertThresholdAed));
      if (g?.crossedAlert) await safe(() => Promise.resolve(this.deps.onAlert?.(ym, g.totalAed)));
    }
    return result;
  }
}

/** Settle/record must never turn a successful provider call into a thrown error (the spend is already
 *  incurred; losing a ledger write is acceptable, breaking the rep's result is not). */
async function safe(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (err) {
    console.warn(`[ai-gate] post-call bookkeeping failed (call result unaffected): ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function safeVal<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (err) {
    console.warn(`[ai-gate] global-record failed (call result unaffected): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * The single process-wide gate (mirrors metered.ts's setSpendSink idiom). Set ONCE at boot (index.ts);
 * the gated provider wrappers read it. When unset (unit tests that build services directly), the
 * wrappers pass straight through — the wiring guard asserts prod actually sets it, so a boot that forgot
 * can never ship dark.
 */
let gate: AiGate | null = null;
export function setAiGate(g: AiGate): void {
  gate = g;
}
export function currentAiGate(): AiGate | null {
  return gate;
}
