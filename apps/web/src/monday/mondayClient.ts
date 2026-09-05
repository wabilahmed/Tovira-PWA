/** Client for the Monday Morning Scan digest (P3-8). */

export interface MondayDigest {
  weekOf: string;
  promisesDue: Array<{ id: string; text: string; dueDate: string | null; clientId: string }>;
  coolingClients: Array<{ id: string; name: string; lastTouchedAt?: number }>;
  unansweredQuestions: Array<{ clientId: string; question: string; date: string | null }>;
  upcomingDates: Array<{ clientId: string; description: string; date: string }>;
  /** [INV-MATCH] Strong inventory suggestions surfaced this week the rep hasn't acted on. Optional
   *  for forward-compat with older payloads (treated as empty). */
  surfacedNotActed?: Array<{ clientId: string; itemTitle: string; requirementRaw: string; statedOn: string | null; noteId: string }>;
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
