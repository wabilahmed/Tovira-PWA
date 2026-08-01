/** Client for conversational recall (P4-8). */

export interface Receipt {
  quote: string;
  date: string;
  clientId: string;
  noteId: string;
}

export interface RecallAnswer {
  answer: string;
  receipts: Receipt[];
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
}
