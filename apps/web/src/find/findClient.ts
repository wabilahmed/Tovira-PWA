/** [P39-7] Find: fixed questions answered from stored data (GET /find/:query). No model, no allowance. */
export type FindQuery = 'missed-promises' | 'due-this-week' | 'no-reply' | 'wanting' | 'deals-at-risk' | 'open-requirements' | 'active-clients' | 'cold-clients';
export type WantingBy = 'type' | 'area' | 'budget' | 'topic' | 'timing';

export interface FindReceipt { quote: string; at: string | null; noteId: string | null; clientId: string; sender: string | null }
export interface FindItem {
  clientId: string;
  clientName: string;
  line: string;
  meta: string | null;
  overdue: boolean;
  owner: 'rep' | 'client' | null;
  tags: string[];
  /** [P40-3] The client's status — its pill on client lists (a Warm client in Cold shows "Warm"). */
  leadStatus?: 'warm' | 'cold' | 'done' | null;
  receipt: FindReceipt | null;
}
export interface FindResult { query: FindQuery; count: number; items: FindItem[]; footnote: string | null }
/** [P42-B5] Only values on record: property type and area from property needs, topic and timing from any other. */
export interface WantingOptions { type: string[]; area: string[]; budget: Array<{ value: string; label: string }>; topic: string[]; timing: Array<{ value: string; label: string }> }

export interface FindApi {
  run(query: FindQuery, filter?: { by: WantingBy; value: string }): Promise<FindResult | 'paused' | null>;
  wantingOptions(): Promise<WantingOptions | 'paused' | null>;
}

export class FindClient implements FindApi {
  constructor(private readonly baseUrl: string = '') {}

  private async get<T>(path: string): Promise<T | 'paused' | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { credentials: 'include' });
      if (res.status === 402) return 'paused';
      if (res.status !== 200) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  run(query: FindQuery, filter?: { by: WantingBy; value: string }): Promise<FindResult | 'paused' | null> {
    const qs = filter ? `?by=${encodeURIComponent(filter.by)}&value=${encodeURIComponent(filter.value)}` : '';
    return this.get<FindResult>(`/find/${query}${qs}`);
  }

  wantingOptions(): Promise<WantingOptions | 'paused' | null> {
    return this.get<WantingOptions>('/find/wanting/options');
  }
}
