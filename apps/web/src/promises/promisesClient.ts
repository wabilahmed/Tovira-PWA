/** Client for the open-promises tracker + confirmation queue (P4-1 / P1-7). */

export interface OpenPromise {
  id: string;
  clientId: string;
  text: string;
  owner: string;
  dueDate: string | null;
  dueRaw: string | null;
  confidence: string;
  done: boolean;
  confirmed: boolean;
}

export class PromisesClient {
  constructor(private readonly baseUrl: string = '') {}

  private async listFrom(path: string): Promise<OpenPromise[]> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { promises: OpenPromise[] }).promises;
    } catch {
      return [];
    }
  }

  /** Every open promise across all clients, due-date order (no-date last). */
  listOpen(): Promise<OpenPromise[]> {
    return this.listFrom('/promises');
  }

  /** Uncertain items awaiting the rep's confirm/reject (P1-7). */
  listConfirmations(): Promise<OpenPromise[]> {
    return this.listFrom('/confirmations');
  }

  private async post(path: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { method: 'POST', credentials: 'include' });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  markDone(id: string): Promise<boolean> {
    return this.post(`/promises/${id}/done`);
  }

  confirm(id: string): Promise<boolean> {
    return this.post(`/promises/${id}/confirm`);
  }

  async reject(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/promises/${id}`, { method: 'DELETE', credentials: 'include' });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
