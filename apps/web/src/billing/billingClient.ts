/** Client for the trial + subscription (P5-1/P5-2). Webhooks are the server's
 *  source of truth — this only reads status and starts checkout. */

export interface Entitlement {
  entitled: boolean;
  status: string; // 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  trialEndsAt: number;
}

/** Server-computed +7-day extension incentive (P5-1-UI). The client renders this
 *  verbatim and never computes eligibility itself. */
export interface ExtensionIncentive {
  state: 'progress' | 'earned' | 'hidden';
  distinctClients: number;
  needed: number;
  remaining: number;
  extensionDays: number;
  trialEndsAt: number;
}

const HIDDEN_INCENTIVE: ExtensionIncentive = {
  state: 'hidden',
  distinctClients: 0,
  needed: 3,
  remaining: 3,
  extensionDays: 7,
  trialEndsAt: 0,
};

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

  /** The server-computed extension incentive. On any failure we fall back to
   *  `hidden` — the client must never invent eligibility the server didn't grant. */
  async incentive(): Promise<ExtensionIncentive> {
    try {
      const res = await fetch(`${this.baseUrl}/billing/incentive`, { credentials: 'include' });
      if (res.status !== 200) return HIDDEN_INCENTIVE;
      return (await res.json()) as ExtensionIncentive;
    } catch {
      return HIDDEN_INCENTIVE;
    }
  }

  /** Start Stripe Checkout for the chosen plan; returns the URL to send the rep to. */
  async checkout(plan: 'monthly' | 'annual' = 'monthly'): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/billing/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (res.status !== 200) return null;
      return ((await res.json()) as { url: string }).url;
    } catch {
      return null;
    }
  }
}
