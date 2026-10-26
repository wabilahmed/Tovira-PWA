import { ExpleeError, type ExpleeApi, type ExpleeCampaign, type ExpleeHotLeadsPage } from '../../ports/hot-leads.js';

export { ExpleeError, type ExpleeApi };

/**
 * [P45-3] The Explee public API (https://api.explee.com/public/api/openapi.json): hot leads + campaigns, auth by the
 * `X-API-Key` header. The key is held here only; it is never logged, never put in an error message, never returned.
 */
export class HttpExpleeClient implements ExpleeApi {
  constructor(private readonly apiKey: string, private readonly baseUrl = 'https://api.explee.com', private readonly timeoutMs = 30_000) {}

  private async get<T>(path: string, query: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'X-API-Key': this.apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new ExpleeError(0, `Explee unreachable (${err instanceof Error ? err.name : 'error'})`); // never echo the request
    }
    if (!res.ok) throw new ExpleeError(res.status, `Explee answered ${res.status}`); // the body is not echoed either
    return (await res.json()) as T;
  }

  hotLeads(q: { since: string | null; limit: number; offset: number }): Promise<ExpleeHotLeadsPage> {
    return this.get('/public/api/v1/autogtm/hot-leads', { limit: String(q.limit), offset: String(q.offset), ...(q.since ? { since: q.since } : {}) });
  }

  async campaigns(): Promise<ExpleeCampaign[]> {
    return (await this.get<{ campaigns: ExpleeCampaign[] }>('/public/api/v1/autogtm/campaigns', {})).campaigns ?? [];
  }
}
