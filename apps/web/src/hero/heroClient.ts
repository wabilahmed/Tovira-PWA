/** Client for the hero features: today, cross-client patterns, risk (P4b-*). */

export interface GateState {
  unlocked: boolean;
  counts: { clients: number; notes: number };
  needed: { clients: number; notes: number };
  /** [P34-6] The server's configured gate. Absent on older payloads → derived as counts + needed. */
  thresholds?: { clients: number; notes: number };
  message: string;
}

export interface Pattern {
  id: string;
  title: string;
  description: string;
  confidence: 'observed' | 'tentative';
  evidence: Array<{ clientId: string; name: string }>;
}

export interface RiskItem {
  clientId: string;
  name: string;
  reasons: string[];
}

export interface TodayAction {
  // 'match' (INV-MATCH) enters at priority 0 — below every fact — carrying the client's quoted
  // requirement + date in its subline (a suggestion never appears on the register without its receipt).
  kind: 'promise' | 'meeting' | 'cold' | 'risk' | 'match';
  priority: number;
  text: string;
  clientId: string | null;
  /** A dated fact — the reason this is on the register (server-computed). */
  subline?: string;
  /** [P34-2] The client's name; null = genuinely no client ("Your note"); absent on older payloads. */
  clientName?: string | null;
  /** [P34-2] The bare action (no "Due soon:" prefix — the date is in the subline). */
  title?: string;
  /** [P34-2] Whose action — a client-owned promise reads "<name> promised: …". */
  owner?: 'rep' | 'client';
  refId?: string;
  /** [P34-7] Where it came from, sent with the list. Absent on a list cached before this field existed. */
  receipt?: { quote: string | null; source: 'message' | 'capture' | 'none' | 'contact'; at: string | null };
}

export class HeroClient {
  constructor(private readonly baseUrl: string = '') {}

  private async get<T>(path: string, pick: (body: unknown) => T, fallback: T): Promise<T> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { credentials: 'include' });
      if (res.status !== 200) return fallback;
      return pick(await res.json());
    } catch {
      return fallback;
    }
  }

  status(): Promise<GateState | null> {
    return this.get('/hero/status', (b) => b as GateState, null);
  }
  patterns(): Promise<Pattern[]> {
    return this.get('/hero/patterns', (b) => (b as { patterns: Pattern[] }).patterns, []);
  }
  risk(): Promise<RiskItem[]> {
    return this.get('/hero/risk', (b) => (b as { atRisk: RiskItem[] }).atRisk, []);
  }
  /** [P34-5] The day's list plus how many manual refreshes are left (null if the server didn't say). */
  today(): Promise<{ actions: TodayAction[]; refreshesRemaining: number | null }> {
    return this.get(
      '/today',
      (b) => {
        const body = b as { actions: TodayAction[]; refreshesRemaining?: number };
        return { actions: body.actions, refreshesRemaining: typeof body.refreshesRemaining === 'number' ? body.refreshesRemaining : null };
      },
      { actions: [], refreshesRemaining: null },
    );
  }

  /** Manual refresh of today's priorities (rate-limited server-side). */
  async refreshToday(): Promise<{ actions: TodayAction[]; refreshesRemaining: number } | 'rate_limited' | null> {
    try {
      const res = await fetch(`${this.baseUrl}/today/refresh`, { method: 'POST', credentials: 'include' });
      if (res.status === 429) return 'rate_limited';
      if (res.status !== 200) return null;
      return (await res.json()) as { actions: TodayAction[]; refreshesRemaining: number };
    } catch {
      return null;
    }
  }
}
