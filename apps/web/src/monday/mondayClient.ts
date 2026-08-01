/** Client for the Monday Morning Scan digest (P3-8). */

export interface MondayDigest {
  weekOf: string;
  promisesDue: Array<{ id: string; text: string; dueDate: string | null; clientId: string }>;
  coolingClients: Array<{ id: string; name: string }>;
  unansweredQuestions: Array<{ clientId: string; question: string; date: string | null }>;
  upcomingDates: Array<{ clientId: string; description: string; date: string }>;
  isLight: boolean;
}

export class MondayClient {
  constructor(private readonly baseUrl: string = '') {}

  async get(): Promise<MondayDigest | null> {
    try {
      const res = await fetch(`${this.baseUrl}/monday-digest`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as MondayDigest;
    } catch {
      return null;
    }
  }
}
