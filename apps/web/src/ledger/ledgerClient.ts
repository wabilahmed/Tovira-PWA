/** Client for the Recovered Value Ledger (P4-11). */

export type LedgerEventType = 'thread_reopened' | 'promise_kept' | 'brief_before_meeting' | 'inventory_suggested_bought';

/** [P46-5] One deal Tovira helped with: what Tovira suggested (with the client's words), the sale the rep marked, the value. */
export interface LedgerEntry {
  id: string;
  clientId: string;
  clientName: string;
  itemTitle: string;
  suggestedAt: number;
  receipt: { quote: string; statedOn: string | null; noteId: string } | null;
  outcome: 'bought';
  outcomeAt: number;
  dealValueAed: number | null;
}

export interface LedgerSummary {
  totalTouched: number;
  byType: Record<LedgerEventType, number>;
  aed: number | null;
  items: Array<{ type: LedgerEventType; clientId: string; sourceId: string; occurredAt: number }>;
  /** [P46-5] The Ledger's entries, newest first. */
  entries: LedgerEntry[];
}

export class LedgerClient {
  constructor(private readonly baseUrl: string = '') {}

  async summary(): Promise<LedgerSummary | null> {
    try {
      const res = await fetch(`${this.baseUrl}/ledger`, { credentials: 'include' });
      if (res.status !== 200) return null;
      const body = (await res.json()) as LedgerSummary;
      return { ...body, entries: Array.isArray(body.entries) ? body.entries : [] };
    } catch {
      return null;
    }
  }

  /** [P46-5] The deal value on one entry, in AED; null clears it. */
  async setEntryDealValue(entryId: string, aed: number | null): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/ledger/entries/${encodeURIComponent(entryId)}/deal-value`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aed }),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async setDealValue(clientId: string, aed: number): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/clients/${clientId}/deal-value`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aed }),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
