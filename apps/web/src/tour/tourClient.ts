/** [P37] The required tour's state on the account (GET/PUT /me/tour, POST /me/tour/complete). */
export interface TourState { required: boolean; step: number; steps: number; version: number }

export interface TourApi {
  state(): Promise<TourState | null>;
  saveStep(step: number): Promise<void>;
  complete(): Promise<void>;
}

export class HttpTourClient implements TourApi {
  constructor(private readonly baseUrl: string = '') {}

  async state(): Promise<TourState | null> {
    try {
      const res = await fetch(`${this.baseUrl}/me/tour`, { credentials: 'include' });
      return res.status === 200 ? ((await res.json()) as TourState) : null;
    } catch {
      return null;
    }
  }

  async saveStep(step: number): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/me/tour`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step }) });
    } catch { /* the tour keeps going; the next save catches up */ }
  }

  async complete(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/me/tour/complete`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
    } catch { /* best effort — it will be offered again next login, never lost */ }
  }
}
