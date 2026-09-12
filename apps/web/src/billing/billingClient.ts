/** Client for the trial + subscription (P5-1/P5-2). Webhooks are the server's
 *  source of truth — this only reads status and starts checkout. */

export interface Entitlement {
  entitled: boolean;
  status: string; // 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  trialEndsAt: number;
  /** Next renewal date (epoch ms) from the webhook, or null when unknown (P5-2). */
  renewsAt?: number | null;
}

// [TRIAL-14] The usage-gated trial-extension incentive is removed — the trial is a flat 14 days, so
// there is no "earn more days" state to render and no /billing/incentive endpoint to read.

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

  /** [INVOICE-DATA] Set the billing name (+ optional company) for the Stripe customer, so invoices
   *  carry a name. Best-effort; returns whether it saved. */
  async setCustomer(name: string, company?: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/billing/customer`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, ...(company ? { company } : {}) }),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
