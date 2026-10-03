/** [USAGE-ALLOWANCE] Client for the AI-usage meter. The server sends ONLY a percentage + a reset date +
 *  the (product-priced) top-up options — never dirhams of usage, tokens, or per-action cost (D3). */

export interface TopUpChoice {
  id: string;
  label: string; // e.g. '+25%'
  priceAed: number; // what the rep pays (a product price, D6)
}

export interface AllowanceStatus {
  percentUsed: number; // rounded down, never 100 until actually paused (D3)
  exhausted: boolean;
  resetAt: string | null; // ISO date the allowance resets (D9)
  canTopUp: boolean; // false in trial (D10)
  options: TopUpChoice[];
}

export class AllowanceClient {
  constructor(private readonly baseUrl: string = '') {}

  async status(): Promise<AllowanceStatus | null> {
    try {
      const res = await fetch(`${this.baseUrl}/allowance/status`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as AllowanceStatus;
    } catch {
      return null;
    }
  }

  /** Start a one-time top-up checkout; returns the Stripe URL to redirect to. */
  async topUp(optionId: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/billing/top-up`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ optionId }),
      });
      if (res.status !== 200) return null;
      return ((await res.json()) as { url: string }).url;
    } catch {
      return null;
    }
  }
}
