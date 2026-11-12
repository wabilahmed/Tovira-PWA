/**
 * [P65 · owner] What Tovira is doing with what the rep sent (GET /processing). The server is the source of truth, so
 * the status is right whichever page sent it and after the app was closed.
 */
export type CaptureKind = 'chat' | 'voice' | 'typed';
export interface FoundCounts { promises: number; overduePromises: number; dates: number; requirements: number; people: number; needsAnswer: number }
export interface ProcessingItem {
  noteId: string;
  clientId: string;
  clientName: string;
  kind: CaptureKind;
  state: 'working' | 'held' | 'done' | 'failed';
  stage?: 'waiting' | 'transcribing' | 'reading';
  messageCount?: number;
  etaMinutes?: number;
  hold?: 'allowance' | 'subscribe' | 'payment';
  found?: FoundCounts;
  failure?: { reason: 'ours' | 'recording_missing'; canRetry: boolean };
  startedAt: number;
  settledAt: number | null;
}
export interface ProcessingStatus { items: ProcessingItem[]; working: number }
export const EMPTY_STATUS: ProcessingStatus = { items: [], working: 0 };

export interface ProcessingApi {
  status(): Promise<ProcessingStatus | null>;
  /** Try again: read it once more from what is already stored. */
  retry(noteId: string): Promise<boolean>;
}

export class ProcessingClient implements ProcessingApi {
  constructor(private readonly baseUrl = '') {}
  async status(): Promise<ProcessingStatus | null> {
    try {
      const res = await fetch(`${this.baseUrl}/processing`, { credentials: 'include' });
      return res.status === 200 ? ((await res.json()) as ProcessingStatus) : null;
    } catch { return null; }
  }
  async retry(noteId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/notes/${encodeURIComponent(noteId)}/extract`, { method: 'POST', credentials: 'include' });
      return res.status === 202;
    } catch { return false; }
  }
}

/** "chat", "voice note", "note" */
export const NOUN: Record<CaptureKind, string> = { chat: 'chat', voice: 'voice note', typed: 'note' };

/** The toast the moment something is sent: "Analysing your chat with Anjali Mehra…" */
export function readingToast(kind: CaptureKind, clientName: string): string {
  return kind === 'chat' ? `Analysing your chat with ${clientName}…` : `Analysing your ${NOUN[kind]} about ${clientName}…`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Nothing worth showing was found: no promise, date, requirement or person. */
export const foundNothing = (f: FoundCounts): boolean => f.promises + f.dates + f.requirements + f.people === 0;

/** The toast when it is ready and the rep is elsewhere: "Anjali Mehra is ready: 4 promises, 2 dates." */
export function readyToast(item: ProcessingItem): string {
  if (item.state === 'failed' || item.state === 'held') return `Tovira couldn't analyse your ${NOUN[item.kind]} for ${item.clientName}.`;
  const f = item.found;
  if (!f || foundNothing(f)) return `${item.clientName} is ready.`;
  const parts = [f.promises ? plural(f.promises, 'promise') : null, f.dates ? plural(f.dates, 'date') : null].filter(Boolean);
  if (parts.length === 0) parts.push(f.requirements ? plural(f.requirements, 'requirement') : plural(f.people, 'person', 'people'));
  return `${item.clientName} is ready: ${parts.join(', ')}.`;
}
