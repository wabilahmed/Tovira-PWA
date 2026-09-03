/** Client for conversational recall (P4-8). */

export interface Receipt {
  quote: string;
  date: string;
  clientId: string;
  noteId: string;
}

/** [ASK-CAPTURE] present only when the rep's turn was a factual statement about a client. */
export interface CaptureOutcome {
  status: 'captured' | 'needs_client' | 'none';
  statement?: string;
  clientName?: string;
  noteId?: string;
}

export interface RecallAnswer {
  answer: string;
  receipts: Receipt[];
  capture?: CaptureOutcome;
}

export class RecallClient {
  constructor(private readonly baseUrl: string = '') {}

  async ask(question: string): Promise<RecallAnswer | null> {
    try {
      const res = await fetch(`${this.baseUrl}/recall`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (res.status !== 200) return null;
      return (await res.json()) as RecallAnswer;
    } catch {
      return null;
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
