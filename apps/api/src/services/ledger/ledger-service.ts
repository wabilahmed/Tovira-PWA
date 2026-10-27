import type { LedgerEvent, LedgerEventType, LedgerRepository } from '../../ports/ledger-repository.js';

/**
 * Recovered Value Ledger (P4-11). A running record of value Tovira TOUCHED —
 * threads reopened after a flag, promises kept on time, briefs before meetings.
 * Honesty rules are the whole point: "touched" not "closed", no causal claims,
 * AED only from rep-entered deal values (never estimated), every entry links to
 * its event, and totals are recomputed from stored events (never a cached
 * counter) so a deleted event removes its value.
 */

export interface LedgerItem {
  type: LedgerEventType;
  clientId: string;
  sourceId: string;
  occurredAt: number;
}

export interface LedgerSummary {
  totalTouched: number;
  byType: Record<LedgerEventType, number>;
  /** AED of touched pipeline — null unless the rep has entered deal values. */
  aed: number | null;
  items: LedgerItem[];
}

export class LedgerService {
  constructor(private readonly repo: LedgerRepository) {}

  record(userId: string, event: LedgerEvent): Promise<boolean> {
    return this.repo.record(userId, event);
  }

  /** [P46-5] The stored events (for the Ledger's entries). */
  listEvents(userId: string): ReturnType<LedgerRepository['listByUser']> {
    return this.repo.listByUser(userId);
  }

  /** [P47-1] Remove a client's entries of one type. */
  removeWhere(userId: string, where: { clientId: string; type: LedgerEventType }): Promise<void> {
    return this.repo.removeWhere(userId, where);
  }

  removeBySource(userId: string, sourceId: string): Promise<void> {
    return this.repo.removeBySource(userId, sourceId);
  }

  setDealValue(userId: string, clientId: string, aed: number): Promise<void> {
    return this.repo.setDealValue(userId, clientId, aed);
  }

  /** [P46-5] The deal value on one entry (null clears it). False when the entry is not the rep's. */
  setEntryDealValue(userId: string, entryId: string, aed: number | null): Promise<boolean> {
    return this.repo.setEntryDealValue(userId, entryId, aed);
  }

  /** Recomputed from stored events every call — never a cached counter. */
  async summary(userId: string): Promise<LedgerSummary> {
    const events = await this.repo.listByUser(userId);
    const deals = await this.repo.listDealValues(userId);

    const byType: Record<LedgerEventType, number> = { thread_reopened: 0, promise_kept: 0, brief_before_meeting: 0, inventory_suggested_bought: 0, won_after_suggestion: 0 };
    const touchedClients = new Set<string>();
    for (const e of events) {
      byType[e.type] += 1;
      touchedClients.add(e.clientId);
    }

    // AED only when the rep has entered deal values — never estimated. Sum the
    // entered values for clients this ledger actually touched.
    let aed: number | null = null;
    if (deals.length > 0) {
      aed = deals.filter((d) => touchedClients.has(d.clientId)).reduce((sum, d) => sum + d.aed, 0);
    }

    return {
      totalTouched: events.length,
      byType,
      aed,
      items: events.map((e) => ({ type: e.type, clientId: e.clientId, sourceId: e.sourceId, occurredAt: e.occurredAt })),
    };
  }
}
