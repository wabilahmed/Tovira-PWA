/**
 * [P35-3] Receipts as WhatsApp-style chat — the client. Every <ReceiptThread> on a screen asks for its source in
 * the same render; the requests are batched into ONE `POST /receipts/sources` (never one per card), and a tap
 * fetches the thread (`POST /receipts/thread`).
 */
export type BubbleSide = 'rep' | 'other';

export interface Bubble {
  sender: string;
  side: BubbleSide;
  /** "YYYY-MM-DDTHH:MM" (a chat message) or "YYYY-MM-DD" (a note's date); null when unknown. */
  at: string | null;
  text: string;
  source: boolean;
  voice?: boolean;
}

export interface ReceiptSource {
  kind: 'chat' | 'voice' | 'note' | 'quote';
  noteId: string | null;
  repKnown: boolean;
  bubbles: Bubble[];
  hasMore: boolean;
}

export interface ReceiptRef {
  noteId?: string | null;
  clientId?: string | null;
  span?: string | null;
  at?: string | null;
  /** Fallback text (and what shows while the source loads). */
  quote?: string | null;
  /** Fallback sender for a quote-only bubble. */
  sender?: string | null;
}

export interface ReceiptsApi {
  source(ref: ReceiptRef): Promise<ReceiptSource | null>;
  thread(ref: ReceiptRef, full: boolean): Promise<ReceiptSource | null>;
}

const BATCH = 60;

export class HttpReceiptsClient implements ReceiptsApi {
  private queue: Array<{ ref: ReceiptRef; resolve: (s: ReceiptSource | null) => void }> = [];
  private scheduled = false;

  constructor(private readonly baseUrl: string = '') {}

  source(ref: ReceiptRef): Promise<ReceiptSource | null> {
    return new Promise((resolve) => {
      this.queue.push({ ref, resolve });
      if (!this.scheduled) {
        this.scheduled = true;
        setTimeout(() => void this.flush(), 0); // everything asked for in this render → one request
      }
    });
  }

  private async flush(): Promise<void> {
    this.scheduled = false;
    const pending = this.queue;
    this.queue = [];
    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      let sources: Array<ReceiptSource | null> = [];
      try {
        const res = await fetch(`${this.baseUrl}/receipts/sources`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refs: chunk.map((c) => c.ref) }),
        });
        if (res.status === 200) sources = ((await res.json()) as { sources: Array<ReceiptSource | null> }).sources ?? [];
      } catch {
        sources = [];
      }
      chunk.forEach((c, k) => c.resolve(sources[k] ?? null));
    }
  }

  async thread(ref: ReceiptRef, full: boolean): Promise<ReceiptSource | null> {
    try {
      const res = await fetch(`${this.baseUrl}/receipts/thread`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref, full }),
      });
      if (res.status !== 200) return null;
      return ((await res.json()) as { source: ReceiptSource | null }).source;
    } catch {
      return null;
    }
  }
}
