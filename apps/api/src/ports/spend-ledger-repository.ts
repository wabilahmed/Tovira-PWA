/**
 * [SPEND-CAP] Durable per-account, per-billing-period Claude spend. Unlike the in-memory
 * ImportCostMetrics/RecallMetrics (1h rolling, lost on restart), this survives restarts and buckets
 * by the rep's BILLING period, so the cap and the invoice describe the same window. One row per
 * (user, period, cost class); spend accumulates. Embeddings and transcription are NOT Claude spend
 * and are never recorded here.
 */
/**
 * [SPEND-INSTRUMENT] The closed set of model-call classes. Every metered call MUST declare one — a call
 * with no valid class fails loudly (unclassified spend is impossible), never defaults to "other". Renamed
 * `followup`→`draft` and added `canary` (system health probe, charged to no account) per the batch's
 * taxonomy; `import` is extraction-of-a-chat; `capture` is Ask-capture statement detection. (`brief` and
 * `inventory` make no model call today, and `gate` runs in the eval harness with no spend sink, so none
 * of those appear here — a class with no producer would be a dead emitter.)
 */
export const SPEND_CLASSES = ['extraction', 'import', 'recall', 'priorities', 'draft', 'meeting', 'capture', 'canary', 'erasure'] as const;
export type SpendClass = (typeof SPEND_CLASSES)[number];
const SPEND_CLASS_SET: ReadonlySet<string> = new Set(SPEND_CLASSES);
export function isSpendClass(v: unknown): v is SpendClass {
  return typeof v === 'string' && SPEND_CLASS_SET.has(v);
}

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
