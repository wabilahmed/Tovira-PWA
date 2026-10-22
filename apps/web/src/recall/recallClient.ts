/** [P39-7] The pending-note client: "Add a note" holds a statement for confirmation, and To Confirm lists,
 *  confirms or rejects it. (The free-text Ask — POST /recall — is gone; Find answers fixed questions.) */

/** [P21-A3] A held statement ("Add a note"), waiting in To Confirm. */
export interface PendingCapture {
  noteId: string;
  clientId: string;
  clientName: string;
  statement: string;
  capturedAt: number;
  summary?: string;
  /** [P39-6] The field + value the statement sets, when it sets a known one ("budget", "2.2M"). */
  field?: string;
  value?: string;
}

export class RecallClient {
  constructor(private readonly baseUrl: string = '') {}

  /** [P39-7] "Add a note": hold a statement about a client for confirmation. 'paused' = AI is paused (402). */
  async create(clientId: string, statement: string): Promise<'held' | 'paused' | 'failed'> {
    try {
      const res = await fetch(`${this.baseUrl}/captures`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, statement }),
      });
      return res.status === 201 ? 'held' : res.status === 402 ? 'paused' : 'failed';
    } catch {
      return 'failed';
    }
  }

  /** [P21-A3] The held Ask statements awaiting confirmation (the To Confirm queue). */
  async listCaptures(): Promise<PendingCapture[]> {
    try {
      const res = await fetch(`${this.baseUrl}/captures`, { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { captures?: PendingCapture[] }).captures ?? [];
    } catch {
      return [];
    }
  }

  /** Confirm a captured statement into the vault, or reject it (nothing enters unconfirmed). */
  async confirmCapture(noteId: string): Promise<boolean> {
    return this.captureAction(noteId, 'confirm');
  }
  async rejectCapture(noteId: string): Promise<boolean> {
    return this.captureAction(noteId, 'reject');
  }
  private async captureAction(noteId: string, action: 'confirm' | 'reject'): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/captures/${encodeURIComponent(noteId)}/${action}`, { method: 'POST', credentials: 'include' });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
