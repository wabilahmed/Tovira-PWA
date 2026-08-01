/** Client for the Recovered Value Ledger (P4-11). */

export type LedgerEventType = 'thread_reopened' | 'promise_kept' | 'brief_before_meeting';

export interface LedgerSummary {
  totalTouched: number;
  byType: Record<LedgerEventType, number>;
  aed: number | null;
  items: Array<{ type: LedgerEventType; clientId: string; sourceId: string; occurredAt: number }>;
}

export class LedgerClient {
  constructor(private readonly baseUrl: string = '') {}

  async summary(): Promise<LedgerSummary | null> {
    try {
      const res = await fetch(`${this.baseUrl}/ledger`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as LedgerSummary;
    } catch {
      return null;
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
