/**
 * [SPEND-CAP] Durable per-account, per-billing-period Claude spend. Unlike the in-memory
 * ImportCostMetrics/RecallMetrics (1h rolling, lost on restart), this survives restarts and buckets
 * by the rep's BILLING period, so the cap and the invoice describe the same window. One row per
 * (user, period, cost class); spend accumulates. Embeddings and transcription are NOT Claude spend
 * and are never recorded here.
 */
export type SpendClass = 'extraction' | 'import' | 'recall' | 'priorities' | 'followup' | 'meeting' | 'capture';

export interface SpendByClass {
  costClass: SpendClass;
  aed: number;
  calls: number;
}

export interface PeriodSpend {
  totalAed: number;
  byClass: SpendByClass[];
}

export interface SpendLedgerRepository {
  /** Add cost to (user, period, class), accumulating. Idempotency is the caller's concern; each
   *  real model call adds once. */
  add(userId: string, periodKey: string, costClass: SpendClass, aed: number): Promise<void>;
  /** The rep's total + per-class spend for a period (empty → zero). */
  getForPeriod(userId: string, periodKey: string): Promise<PeriodSpend>;
  /** Every rep with spend in a period — for the /health distribution + the ops view. */
  listPeriod(periodKey: string): Promise<Array<{ userId: string; totalAed: number }>>;
}
