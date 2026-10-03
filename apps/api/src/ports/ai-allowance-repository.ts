/**
 * [USAGE-ALLOWANCE] The AI-allowance ledger (Task 2). Per-account, per-monthly-window usage with an
 * atomic reservation protocol, plus a global calendar-month spend record for the email alert only
 * (never a wall — D13 removed). All AED.
 *
 * A window row holds: the monthly `allowanceAed` (D1), the `topupAed` available this window (carried-in
 * remainder + purchases, D7/D8), settled `spentAed`, and in-flight `reservedAed`. Available this window
 * = allowanceAed + topupAed. The gate (Task 3) reserves worst-case BEFORE a call and settles the actual
 * AFTER, so two parallel calls can never both fit the same headroom.
 */
export interface AiMonth {
  userId: string;
  periodKey: string;
  periodStartMs: number;
  allowanceAed: number;
  topupAed: number;
  spentAed: number;
  reservedAed: number;
}

export interface ReserveResult {
  ok: boolean;
  reservationId?: string;
}

export interface GlobalSpendResult {
  totalAed: number;
  /** True ONLY on the settle that pushes the calendar-month total across the alert threshold — one-shot. */
  crossedAlert: boolean;
}

export interface AiAllowanceRepository {
  /** Ensure this window's row exists, carrying forward the previous window's REMAINING top-up (D7/D8).
   *  Idempotent: an existing row is returned unchanged. */
  ensureMonth(userId: string, periodKey: string, periodStartMs: number, allowanceAed: number): Promise<AiMonth>;

  /** Atomically reserve `estimateAed` against this window. Succeeds ONLY if
   *  spent + reserved + estimate <= allowance + topup, as a single conditional update. On success the
   *  reservation is recorded (open, with `expiresAtMs`) so it can be settled or expired later. */
  reserve(userId: string, periodKey: string, estimateAed: number, expiresAtMs: number): Promise<ReserveResult>;

  /** Settle an open reservation: release its estimate from `reserved` and add `actualAed` to `spent`. */
  settle(userId: string, reservationId: string, actualAed: number): Promise<void>;

  /** Release an open reservation WITHOUT charging (a refused/aborted call). Frees its estimate. */
  release(userId: string, reservationId: string): Promise<void>;

  /** Expire every open reservation past its expiry (a crashed mid-call), freeing its estimate. Returns
   *  the number expired. */
  expireStale(nowMs: number): Promise<number>;

  /** Credit a confirmed top-up to this window (D6/D12): raises available, so the meter's % drops (D8). */
  topUp(userId: string, periodKey: string, addedAed: number): Promise<void>;

  /** The current window row, for the meter. null if none yet. */
  getMonth(userId: string, periodKey: string): Promise<AiMonth | null>;

  /** Add settled spend to the GLOBAL calendar-month (`ym` = 'YYYY-MM') total. Flags the single crossing
   *  of `alertThresholdAed` so exactly one alert email is sent; never blocks. */
  recordGlobal(ym: string, aed: number, alertThresholdAed: number): Promise<GlobalSpendResult>;
}
