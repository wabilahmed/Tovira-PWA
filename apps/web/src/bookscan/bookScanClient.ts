/** Client for the Day-One Book Scan (P5-3b). Same-origin, cookie session. */

export type BookScanKind = 'open_promise' | 'unanswered_question' | 'going_cold' | 'upcoming_date';

export interface BookScanItem {
  kind: BookScanKind;
  clientId: string;
  clientName: string;
  headline: string;
  receipt: { quote: string; date: string | null };
  framing: 'worth_checking' | 'informational';
}

export interface BookScanReport {
  items: BookScanItem[];
  isEmpty: boolean;
  message: string | null;
  invitation: string;
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
