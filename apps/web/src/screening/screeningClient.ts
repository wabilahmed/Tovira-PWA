/** [SCREEN-REVIEW] Client for the held-flag review + restore. Same-origin, cookie session. */

export interface HeldMessageView {
  index: number;
  sender: string;
  sentAt: string | null;
  body: string;
}
export interface SpanGroup {
  span: string;
  count: number;
  messages: HeldMessageView[];
}
export interface CategoryGroup {
  category: string;
  count: number;
  spans: SpanGroup[];
}
export interface FlagReviewData {
  held: number;
  groups: CategoryGroup[];
}
/** Restore one message by index, or all in a category (optionally a single matched span). */
export type RestoreSelector = { index: number } | { category: string; span?: string };

export interface ScreeningApi {
  flags(noteId: string): Promise<FlagReviewData | null>;
  restore(noteId: string, sel: RestoreSelector): Promise<{ restored: number; status: string } | null>;
}

export class ScreeningClient implements ScreeningApi {
  constructor(private readonly baseUrl: string = '') {}

  async flags(noteId: string): Promise<FlagReviewData | null> {
    try {
      const res = await fetch(`${this.baseUrl}/notes/${encodeURIComponent(noteId)}/flags`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as FlagReviewData;
    } catch {
      return null;
    }
  }

  async restore(noteId: string, sel: RestoreSelector): Promise<{ restored: number; status: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/notes/${encodeURIComponent(noteId)}/restore`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sel),
      });
      if (res.status !== 200) return null;
      return (await res.json()) as { restored: number; status: string };
    } catch {
      return null;
    }
  }
}
