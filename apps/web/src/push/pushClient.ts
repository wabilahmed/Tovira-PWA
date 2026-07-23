/** Client for Web Push subscription + test (P3-6). */

export class PushClient {
  constructor(private readonly baseUrl: string = '') {}

  /** Persist the browser's push subscription server-side. */
  async saveSubscription(subscription: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/push/subscribe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription),
      });
      return res.status === 201;
    } catch {
      return false;
    }
  }

  /** Ask the server to push a test notification to this rep's devices. */
  async sendTest(): Promise<number> {
    try {
      const res = await fetch(`${this.baseUrl}/push/test`, { method: 'POST', credentials: 'include' });
      if (res.status !== 200) return 0;
      return ((await res.json()) as { sent: number }).sent;
    } catch {
      return 0;
    }
  }
}
