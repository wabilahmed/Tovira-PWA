/** [USAGE-ALLOWANCE → P83 · owner, 21 Nov] Client for the messages meter. The server sends messages only (read, left,
 *  packs, the last pack added) and a reset date; pack prices ride along for the purchase screen, the one place AED
 *  is shown before checkout. Never a usage cost, tokens or a percentage of an allowance. */

export interface TopUpChoice {
  id: string;
  label: string; // '+1,500 messages'
  messages: number;
  priceAed: number; // what the rep pays (shown on the purchase screen only)
}

/** The custom pack: the range, and the price bands the purchase screen uses to show the price as the rep types. The
 *  server recalculates the price at checkout; the browser never sets it. */
export interface CustomPackRange {
  min: number;
  max: number;
  step: number;
  bands: Array<{ from: number; filsPer1000: number }>;
}

export interface AllowanceStatus {
  messagesAllowance: number; // 10,000
  messagesUsed: number;
  messagesTotal: number; // the month's plus pack messages available
  messagesLeft: number;
  packMessagesLeft: number; // never expire
  /** "+N messages added" by the last pack this month, or null. */
  lastTopupMessages: number | null;
  /** Imports stop: no messages left (or AI is stopped for the account). */
  exhausted: boolean;
  messagesExhausted?: boolean;
  resetAt: string | null; // ISO
  canTopUp: boolean; // false in trial (D10)
  options: TopUpChoice[];
  custom: CustomPackRange | null;
  /** [AUDIT item 4] ops AI-pause kill switch is on — processing is delayed, not broken. */
  aiPaused?: boolean;
  /** 'active' | 'trialing' | 'trial_expired' | 'payment_failed' | 'past_due' | 'suspended' | 'ended' | 'canceled' |
   *  'none'. Drives the run-out message. */
  subscription?: string | null;
}

/** A refused checkout carries the server's reason ("The smallest amount is 1,000 messages."). */
export type CheckoutResult = { url: string } | { error: string };

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

  /** Start a fixed-pack checkout; returns the Stripe URL to redirect to. */
  async topUp(optionId: string): Promise<string | null> {
    const r = await this.checkout({ optionId });
    return 'url' in r ? r.url : null;
  }

  /** [P83] Start a custom-pack checkout for `messages`. Only the count is sent: the server sets the price. */
  async topUpCustom(messages: number): Promise<CheckoutResult> {
    return this.checkout({ messages });
  }

  private async checkout(body: { optionId: string } | { messages: number }): Promise<CheckoutResult> {
    try {
      const res = await fetch(`${this.baseUrl}/billing/top-up`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const b = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (res.status === 200 && b.url) return { url: b.url };
      return { error: b.message ?? 'Checkout could not start. Please try again.' };
    } catch {
      return { error: 'Checkout could not start. Please try again.' };
    }
  }
}
