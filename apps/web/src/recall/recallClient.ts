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
  /** [P21-A3] what was held, in the rep's words ("Sara's budget → 2.2M"). */
  summary?: string;
  /** [P21-A3] needs_client: the clients it could be about. */
  candidates?: string[];
}

/** [P21-A3] A statement held from Ask, waiting in To Confirm. */
export interface PendingCapture {
  noteId: string;
  clientId: string;
  clientName: string;
  statement: string;
  capturedAt: number;
  summary?: string;
}

export interface RecallAnswer {
  answer: string;
  receipts: Receipt[];
  /** [P35-2] Retrieved-but-not-the-answer, for a collapsed "Closest messages I found". */
  nearMisses?: Receipt[];
  capture?: CaptureOutcome;
  /** [AUDIT gap C] 402 from the entitlement/billing gate — AI is paused (trial lapsed or payment
   *  failed), not a transient error. The UI shows a "paused, check Billing" notice, not "try again". */
  paused?: boolean;
  /** [AUDIT item 5] the distinct reason the backend returned, so the UI shows the right action
   *  (update card vs subscribe) rather than one generic lock message. */
  pausedReason?: string;
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
      if (res.status === 402) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        return { answer: '', receipts: [], paused: true, pausedReason: b.error }; // [item 5] carry the reason
      }
      if (res.status !== 200) return null;
      return (await res.json()) as RecallAnswer;
    } catch {
      return null;
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
