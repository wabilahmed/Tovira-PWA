import type { SpendClass } from './spend-ledger-repository.js';

/**
 * [SPEND-INSTRUMENT] A durable PER-CALL record of every metered model call — the thing that answers
 * "what did this cost, by feature" from data after a month of pilot, rather than re-estimating. This is
 * ALONGSIDE the spend ledger (which aggregates AED-by-class for the cap), not a replacement: it keeps the
 * token breakdown and cache outcome the ledger throws away. System calls (canary) are recorded here with
 * `userId = null` (charged to no account); rep calls carry their billing-period bucket.
 */
export interface ModelCallEvent {
  userId: string | null; // null = system call (charged to no account)
  periodKey: string | null; // the rep's billing-period bucket; null for a system call
  spendClass: SpendClass;
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number; // reasoning tokens (billed inside output); 0 if the provider didn't report
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHit: boolean; // cacheReadTokens > 0
  costAed: number;
  at: number;
}

/** One class's totals over a period — the readable per-feature cost (B3). */
export interface ClassAggregate {
  spendClass: SpendClass;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costAed: number;
}

/** One model's totals over a period — the invoice-comparable line (B3): Anthropic bills per model, per
 *  token type, in USD. */
export interface ModelAggregate {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  costAed: number;
}

export interface ModelCallEventStore {
  record(e: ModelCallEvent): Promise<void>;
  /** Per-CLASS totals for a period. `userId` given → that account; omitted → every account + system. */
  aggregateByClass(periodKey: string, userId?: string): Promise<ClassAggregate[]>;
  /** Per-MODEL totals for a period (invoice-comparable). Same scoping as aggregateByClass. */
  aggregateByModel(periodKey: string, userId?: string): Promise<ModelAggregate[]>;
}
