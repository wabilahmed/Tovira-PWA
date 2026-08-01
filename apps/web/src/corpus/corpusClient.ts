/** Client for corpus-value visibility (P4-10). */

export interface CorpusStats {
  months: number;
  moments: number;
}

export class CorpusClient {
  constructor(private readonly baseUrl: string = '') {}

  async get(): Promise<CorpusStats | null> {
    try {
      const res = await fetch(`${this.baseUrl}/corpus-stats`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as CorpusStats;
    } catch {
      return null;
    }
  }
}
