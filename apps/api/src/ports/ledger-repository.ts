/**
 * Port: the Recovered Value Ledger (P4-11). Records only REAL value-touch events
 * (a flagged thread the rep re-engaged, a promise kept on time, a brief viewed
 * before a logged meeting). Every entry links to its underlying event and is
 * removed if that event is deleted. AED comes only from rep-entered deal values —
 * never estimated. Tenant-scoped (RLS on pg).
 */

export type LedgerEventType = 'thread_reopened' | 'promise_kept' | 'brief_before_meeting' | 'inventory_suggested_bought';

export interface LedgerEvent {
  type: LedgerEventType;
  clientId: string;
  /** The underlying promise/meeting/note id — the receipt this entry links to. */
  sourceId: string;
  /** Idempotency: the same real event never double-counts. */
  dedupeKey: string;
  occurredAt: number;
}

export interface LedgerEventRecord extends LedgerEvent {
  id: string;
  userId: string;
}

export interface DealValue {
  clientId: string;
  aed: number;
}

export interface LedgerRepository {
  /** Record an event unless its dedupeKey already exists. Returns true if new. */
  record(userId: string, event: LedgerEvent): Promise<boolean>;
  listByUser(userId: string): Promise<LedgerEventRecord[]>;
  /** Remove any ledger entry whose underlying event was deleted (no orphan claims). */
  removeBySource(userId: string, sourceId: string): Promise<void>;
  setDealValue(userId: string, clientId: string, aed: number): Promise<void>;
  listDealValues(userId: string): Promise<DealValue[]>;
}
