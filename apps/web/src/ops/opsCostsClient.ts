import { OpsUnauthorizedError } from './opsAccessClient.js';

/** [P44-2] Client for GET /ops/costs (ops token only, never the rep session). Mirrors the API's report shape. */
export type CostView = 'period' | 'month';
export interface CostRow {
  userId: string; email: string; plan: string; key: string; periodLabel: string; group: string;
  claudeAed: number; calls: number; byClass: Record<string, number>;
  voiceSeconds: number | null; voiceAed: number | null; voiceEstimated: boolean;
  totalCostAed: number; revenueAed: number; marginAed: number; marginPct: number | null;
  overCeiling: boolean; cap: { capAed: number; spentAed: number; reached: boolean } | null;
}
export interface CostTotals { group: string; label: string; costAed: number; revenueAed: number; marginAed: number; marginPct: number | null }
export interface CostReport { view: CostView; ceilingAed: number; voiceRecordedSince: number | null; rows: CostRow[]; totals: CostTotals[] }

export interface OpsCostsApi {
  get(token: string, view: CostView): Promise<CostReport>;
  downloadCsv(token: string, view: CostView): Promise<void>;
}

export class HttpOpsCostsClient implements OpsCostsApi {
  constructor(private readonly baseUrl: string = '') {}

  private async fetch(token: string, view: CostView, csv: boolean): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/ops/costs?view=${view}${csv ? '&format=csv' : ''}`, { headers: { 'x-ops-token': token }, credentials: 'omit' });
    if (res.status === 403) throw new OpsUnauthorizedError();
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res;
  }

  async get(token: string, view: CostView): Promise<CostReport> {
    return (await (await this.fetch(token, view, false)).json()) as CostReport;
  }

  /** The CSV needs the ops-token header, so it is fetched and saved through a temporary link. */
  async downloadCsv(token: string, view: CostView): Promise<void> {
    const blob = await (await this.fetch(token, view, true)).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tovira-costs-${view}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
