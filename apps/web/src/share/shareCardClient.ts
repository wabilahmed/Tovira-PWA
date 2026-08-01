/** Client for the share card (P5-6) — counts only, no identifiers. */

export interface ShareCardStats {
  openPromises: number;
  unansweredQuestions: number;
  goingCold: number;
  upcomingDates: number;
  total: number;
}

export class ShareCardClient {
  constructor(private readonly baseUrl: string = '') {}

  async get(): Promise<ShareCardStats | null> {
    try {
      const res = await fetch(`${this.baseUrl}/share-card`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as ShareCardStats;
    } catch {
      return null;
    }
  }
}
