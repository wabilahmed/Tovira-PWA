/** Client for the Day-One Book Scan (P5-3b). Same-origin, cookie session. */

export type BookScanKind = 'open_promise' | 'unanswered_question' | 'going_cold' | 'upcoming_date';

export interface BookScanItem {
  kind: BookScanKind;
  /** [BOOKSCAN-STREAM] Stable, unique server-supplied identity (a fact row id, or a stable composite for
   *  findings with no single backing row) — the key the streaming client uses so it never drops a
   *  finding to a collision. */
  id: string;
  clientId: string;
  clientName: string;
  headline: string;
  receipt: { quote: string; date: string | null };
  framing: 'worth_checking' | 'informational';
}

/** [BOOKSCAN-STREAM] Account-wide extraction progress over imported chats — the still-working vs
 *  finished signal. A failed chat stays in totalChats (never drops the denominator). */
export interface ScanProgress {
  totalChats: number;
  extractedChats: number;
  pendingChats: number;
  failedChats: number;
  done: boolean;
}

export interface BookScanReport {
  items: BookScanItem[];
  isEmpty: boolean;
  message: string | null;
  invitation: string;
  chatsRead?: number;
  scanProgress?: ScanProgress;
}

export class BookScanClient {
  constructor(private readonly baseUrl: string = '') {}

  async scan(): Promise<BookScanReport | null> {
    try {
      const res = await fetch(`${this.baseUrl}/book-scan`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as BookScanReport;
    } catch {
      return null;
    }
  }
}
