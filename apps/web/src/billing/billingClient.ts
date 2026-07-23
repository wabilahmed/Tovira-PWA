/** Client for the trial + subscription (P5-1/P5-2). Webhooks are the server's
 *  source of truth — this only reads status and starts checkout. */

export interface Entitlement {
  entitled: boolean;
  status: string; // 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  trialEndsAt: number;
}

export class BillingClient {
  constructor(private readonly baseUrl: string = '') {}

  async status(): Promise<Entitlement | null> {
    try {
      const res = await fetch(`${this.baseUrl}/billing/status`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as Entitlement;
    } catch {
      return null;
    }
  }

  /** Start Stripe Checkout; returns the URL to send the rep to. */
  async checkout(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/billing/checkout`, { method: 'POST', credentials: 'include' });
      if (res.status !== 200) return null;
      return ((await res.json()) as { url: string }).url;
    } catch {
      return null;
    }
  }
}
