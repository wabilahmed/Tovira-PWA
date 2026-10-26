/** Client for Web Push subscription + test (P3-6). */

/** [P46-2] A test push, and what happened on THIS device. */
export interface TestResult { sent: number; thisDevice: 'sent' | 'failed' | 'gone' | 'not_set_up' }

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

  /** [P46-2] The server's VAPID public key (the web build has none). '' when push is not configured there. */
  async config(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/push/config`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return ((await res.json()) as { vapidPublicKey?: string }).vapidPublicKey ?? '';
    } catch {
      return null;
    }
  }

  /** [P46-2] Does the server have THIS device's subscription? null = could not ask. */
  async isStored(endpoint: string): Promise<boolean | null> {
    try {
      const res = await fetch(`${this.baseUrl}/push/status`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }),
      });
      if (res.status !== 200) return null;
      return ((await res.json()) as { stored: boolean }).stored;
    } catch {
      return null;
    }
  }

  /** Ask the server to push a test notification to this rep's devices, and say what happened on THIS one. */
  async sendTest(endpoint: string | null): Promise<TestResult> {
    try {
      const res = await fetch(`${this.baseUrl}/push/test`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(endpoint ? { endpoint } : {}),
      });
      if (res.status !== 200) return { sent: 0, thisDevice: 'failed' };
      const body = (await res.json()) as { sent: number; thisDevice?: TestResult['thisDevice'] };
      return { sent: body.sent, thisDevice: body.thisDevice ?? 'not_set_up' };
    } catch {
      return { sent: 0, thisDevice: 'failed' };
    }
  }
}
