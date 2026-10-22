/** Client for the open-promises tracker + confirmation queue (P4-1 / P1-7). */

export interface OpenPromise {
  id: string;
  clientId: string;
  text: string;
  owner: string;
  dueDate: string | null;
  dueRaw: string | null;
  confidence: string;
  done: boolean;
  confirmed: boolean;
  /** [P35-3] The note + stored span + message time — resolved to the source chat bubble. */
  noteId?: string;
  sourceSpan?: string | null;
  sourceMessageAt?: string | null;
  /** [P34-7] The stored receipt (verbatim span + when) — sent by /confirmations and /promises. */
  receipt?: { quote: string | null; source: 'message' | 'capture' | 'none'; at: string | null; label: string };
  /** [P34-3] When the item was written (ms) — the To Confirm queue shows the newest first. */
  createdAt?: number;
  /** [P34-2] The client's name, for To Confirm cards (/confirmations); null = no client; absent elsewhere. */
  clientName?: string | null;
  /** [P40-1] 'to_confirm' — the resolver had no date and the rep hasn't answered; else the rep's answer. */
  dateStatus?: 'to_confirm' | 'not_sure' | 'no_due_date' | null;
  /** [P40-1] On a date to confirm: the resolver's reading of the phrase, when it has one (never the model's). */
  suggestedDate?: string | null;
  /** [PROMISE-STALE] overdue past the window → shown behind a filter, out of the active count/claret.
   *  Server-computed by the /promises endpoint; absent (treated false) on older payloads. */
  stale?: boolean;
}

/** [P24-2] A delivery seen in the chat for a still-open promise — the rep decides (Mark done / Not yet). */
export interface KeptSuggestion {
  id: string;
  promiseId: string;
  clientId: string;
  clientName: string;
  message: string;
  promise: { quote: string; date: string | null };
  delivery: { quote: string; date: string };
  /** [P34-3] When the suggestion was raised (ms) — newest first in To Confirm. */
  createdAt?: number;
  /** [P35-3] The chat both messages are in, and their exact times. */
  noteId?: string | null;
  promiseAt?: string | null;
  deliveryAt?: string;
}

/** [P40-1] A meeting the resolver couldn't time ("Saturday afternoon"), waiting for the rep's answer. */
export interface MeetingToConfirm {
  id: string;
  clientId: string;
  clientName?: string | null;
  title: string | null;
  datetimeRaw: string;
  noteId: string | null;
  sourceSpan: string | null;
  sourceMessageAt: string | null;
  captureAt: string | null;
  /** The resolver's reading ("YYYY-MM-DDTHH:MM"), only when it has one. */
  suggestedDatetime: string | null;
  createdAt?: number;
}

export class PromisesClient {
  constructor(private readonly baseUrl: string = '') {}

  private async listFrom(path: string): Promise<OpenPromise[]> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { promises: OpenPromise[] }).promises;
    } catch {
      return [];
    }
  }

  /** Every open promise across all clients, due-date order (no-date last). */
  listOpen(): Promise<OpenPromise[]> {
    return this.listFrom('/promises');
  }

  /** Uncertain items awaiting the rep's confirm/reject (P1-7). */
  listConfirmations(): Promise<OpenPromise[]> {
    return this.listFrom('/confirmations');
  }

  /** [P40-1] Promises whose date the rep needs to give (GET /confirmations → datesToConfirm). */
  async listDatesToConfirm(): Promise<OpenPromise[]> {
    try {
      const res = await fetch(`${this.baseUrl}/confirmations`, { credentials: 'include' });
      if (res.status !== 200) return [];
      const list = ((await res.json()) as { datesToConfirm?: unknown }).datesToConfirm;
      return Array.isArray(list) ? (list as OpenPromise[]) : [];
    } catch {
      return [];
    }
  }

  /** [P40-1] Meetings whose time the rep needs to give (GET /confirmations → meetingDatesToConfirm). */
  async listMeetingDatesToConfirm(): Promise<MeetingToConfirm[]> {
    try {
      const res = await fetch(`${this.baseUrl}/confirmations`, { credentials: 'include' });
      if (res.status !== 200) return [];
      const list = ((await res.json()) as { meetingDatesToConfirm?: unknown }).meetingDatesToConfirm;
      return Array.isArray(list) ? (list as MeetingToConfirm[]) : [];
    } catch {
      return [];
    }
  }

  /** [P40-1] The meeting answer: a time (the rep's wall clock), or "Not sure" / "No date yet". */
  async answerMeetingDate(id: string, answer: { datetime: string } | { dateStatus: 'not_sure' | 'no_date' }): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/meetings/${encodeURIComponent(id)}`, {
        method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(answer),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /** [P40-1] The answer: a date, or "Not sure" / "No due date". */
  async answerDate(id: string, answer: { dueDate: string } | { dateStatus: 'not_sure' | 'no_due_date' }): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/promises/${encodeURIComponent(id)}`, {
        method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(answer),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private async post(path: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { method: 'POST', credentials: 'include' });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /** [P24-2] "Looks like you sent it — Mark done?" suggestions (To Confirm). */
  async listKept(): Promise<KeptSuggestion[]> {
    try {
      const res = await fetch(`${this.baseUrl}/promises/kept-suggestions`, { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { suggestions?: KeptSuggestion[] }).suggestions ?? [];
    } catch {
      return [];
    }
  }
  markKeptDone(id: string): Promise<boolean> {
    return this.post(`/promises/kept-suggestions/${encodeURIComponent(id)}/done`);
  }
  undoKept(id: string): Promise<boolean> {
    return this.post(`/promises/kept-suggestions/${encodeURIComponent(id)}/undo`);
  }
  notYetKept(id: string): Promise<boolean> {
    return this.post(`/promises/kept-suggestions/${encodeURIComponent(id)}/not-yet`);
  }

  markDone(id: string): Promise<boolean> {
    return this.post(`/promises/${id}/done`);
  }

  confirm(id: string): Promise<boolean> {
    return this.post(`/promises/${id}/confirm`);
  }

  async reject(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/promises/${id}`, { method: 'DELETE', credentials: 'include' });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /** [P20-2 / BOOK-09] Soft-delete a promise (undoable). Same endpoint as reject; the row leaves every
   *  surface but is recoverable for 10s via restore(). */
  deletePromise(id: string): Promise<boolean> {
    return this.reject(id);
  }

  /** [P20-2 / BOOK-09] Undo a soft-delete. */
  restore(id: string): Promise<boolean> {
    return this.post(`/promises/${id}/restore`);
  }

  /** [AUDIT item 2] Correct a wrong due date in place — PATCH keeps the note link, so the receipt is
   *  preserved (unlike delete+recreate, which loses it). `null` clears the date. */
  async editDueDate(id: string, dueDate: string | null): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/promises/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dueDate }),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
