/** Client for the hero features: today, cross-client patterns, risk (P4b-*). */

export interface GateState {
  unlocked: boolean;
  counts: { clients: number; notes: number };
  needed: { clients: number; notes: number };
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
  kind: 'promise' | 'meeting' | 'cold' | 'risk';
  priority: number;
  text: string;
  clientId: string | null;
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
  today(): Promise<TodayAction[]> {
    return this.get('/today', (b) => (b as { actions: TodayAction[] }).actions, []);
  }
}
