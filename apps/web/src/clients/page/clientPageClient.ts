import type { FactReceipt } from '../clientsClient.js';

/**
 * [P36-5] The client page's data: one deterministic overview (GET /clients/:id/overview) and the rep's saved
 * section state (GET/PUT /me/ui-prefs — stored with the account, so it follows the rep across devices).
 */
export type SectionKey = 'meeting' | 'wants' | 'promises' | 'meetings' | 'people' | 'conversations';
export const SECTION_KEYS: readonly SectionKey[] = ['meeting', 'wants', 'promises', 'meetings', 'people', 'conversations'];
/** Defaults: the three a rep needs before a meeting open; the rest closed. */
export const DEFAULT_OPEN: Record<SectionKey, boolean> = { meeting: true, wants: true, promises: true, meetings: false, people: false, conversations: false };

export interface OverviewPromise {
  id: string;
  noteId: string;
  text: string;
  owner: string;
  dueDate: string | null;
  done: boolean;
  overdue: boolean;
  stale: boolean;
  sourceSpan: string | null;
  sourceMessageAt: string | null;
  receipt?: FactReceipt;
}
export interface ConversationEntry { noteId: string; kind: 'whatsapp' | 'voice' | 'paste' | 'note'; messageCount: number | null; lastAt: string | null; createdAt: number }
export interface StatusSuggestion { status: 'cold' | 'done'; outcome?: 'lost'; reason: string }
export interface ClientOverview {
  lastMessageAt: string | null;
  openPromises: number;
  overduePromises: number;
  wants: { summary: string | null; listLine: string | null; budgets: string[]; items: Array<{ id: string; text: string; quote: string; noteId: string; statedOn: string | null }> };
  promises: OverviewPromise[];
  nextMeeting: { id: string; datetime: string; title: string | null; confirmed: boolean } | null;
  meetingsCount: number;
  conversations: ConversationEntry[];
  statusSuggestion: StatusSuggestion | null;
}

export interface ClientPageApi {
  overview(clientId: string): Promise<ClientOverview | null>;
  sections(): Promise<Partial<Record<SectionKey, boolean>>>;
  saveSections(change: Partial<Record<SectionKey, boolean>>): Promise<void>;
}

export class HttpClientPageClient implements ClientPageApi {
  constructor(private readonly baseUrl: string = '') {}

  async overview(clientId: string): Promise<ClientOverview | null> {
    try {
      const res = await fetch(`${this.baseUrl}/clients/${encodeURIComponent(clientId)}/overview`, { credentials: 'include' });
      if (res.status !== 200) return null;
      // An unexpected body (an older server mid-deploy, a proxy page) is "no overview", never a crash.
      const body = (await res.json()) as Partial<ClientOverview> | null;
      return body && body.wants && Array.isArray(body.promises) && Array.isArray(body.conversations) ? (body as ClientOverview) : null;
    } catch {
      return null;
    }
  }

  async sections(): Promise<Partial<Record<SectionKey, boolean>>> {
    try {
      const res = await fetch(`${this.baseUrl}/me/ui-prefs`, { credentials: 'include' });
      return res.status === 200 ? (((await res.json()) as { clientSections?: Partial<Record<SectionKey, boolean>> }).clientSections ?? {}) : {};
    } catch {
      return {};
    }
  }

  async saveSections(change: Partial<Record<SectionKey, boolean>>): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/me/ui-prefs`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientSections: change }) });
    } catch { /* best effort — the page still works on its defaults */ }
  }
}

/** "today", "yesterday", "3 days ago", "5 weeks ago", "4 months ago". */
export function ago(at: string | number, nowMs: number): string {
  const ms = typeof at === 'number' ? at : Date.parse(/T\d{2}:\d{2}$/.test(at) ? `${at}:00Z` : at);
  if (Number.isNaN(ms)) return '';
  const days = Math.max(0, Math.floor((nowMs - ms) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
