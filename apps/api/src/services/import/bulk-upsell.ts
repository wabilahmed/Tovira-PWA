/**
 * [BULK-IMPORT · RULING 2] The top-up upsell shown (a) on the review screen before Import when the
 * batch would exceed the remaining allowance, and (b) on the batch result when chats failed at the
 * limit. The shortfall and the "which top-up covers it" decision are computed HERE, on the server,
 * because they depend on AED usage values the client must never see (D3). The client receives only the
 * percentage labels, the prices, and the id of the option to highlight.
 */
import type { TopUpOption } from '../../config.js';

/** What the client is allowed to see about a top-up: the percentage label and the price — never the
 *  added-allowance AED (a usage value) or the shortfall AED. */
export interface TopUpChoice {
  id: string;
  label: string;
  priceAed: number;
}

export interface BulkUpsell {
  /** The batch needs more usage than is left (before Import), or chats failed at the limit (result). */
  shortfall: boolean;
  /** The number the copy speaks about: importable chats (review) or failed chats (result). */
  n: number;
  /** false for a trial account → the web shows "Subscribe to keep importing" instead of options. */
  canTopUp: boolean;
  options: TopUpChoice[];
  /** The smallest option whose added allowance covers the shortfall — highlighted. Null when no
   *  shortfall, or on a trial (no options). */
  recommendedOptionId: string | null;
}

const choice = (o: TopUpOption): TopUpChoice => ({ id: o.id, label: o.label, priceAed: o.priceAed });

/** The smallest top-up whose added allowance covers the shortfall; the largest if none does; null if
 *  there are no options. */
export function pickTopUp(shortfallAed: number, options: readonly TopUpOption[]): TopUpOption | null {
  if (options.length === 0) return null;
  const byAdded = [...options].sort((a, b) => a.addedAed - b.addedAed);
  return byAdded.find((o) => o.addedAed >= shortfallAed) ?? byAdded[byAdded.length - 1]!;
}

export function buildUpsell(
  input: { estimateAed: number; remainingAed: number; canTopUp: boolean; n: number },
  options: readonly TopUpOption[],
): BulkUpsell {
  const shortfall = input.estimateAed > input.remainingAed + 1e-6;
  const canOffer = input.canTopUp && options.length > 0;
  const recommended = shortfall && canOffer ? pickTopUp(input.estimateAed - input.remainingAed, options) : null;
  return {
    shortfall,
    n: input.n,
    canTopUp: input.canTopUp,
    options: canOffer ? options.map(choice) : [],
    recommendedOptionId: recommended ? recommended.id : null,
  };
}

export interface BulkUpsellDeps {
  topUpOptions: readonly TopUpOption[];
  /** Remaining allowance AED for the rep (stays server-side). */
  remainingAllowanceAed: (userId: string) => Promise<number>;
  /** A paying subscriber can top up; a trial cannot (→ Subscribe). */
  canTopUp: (userId: string) => Promise<boolean>;
}

export class BulkUpsellService {
  constructor(private readonly deps: BulkUpsellDeps) {}

  /** Before Import: does this batch's worst-case estimate exceed what the rep has left this month? */
  async forBatch(userId: string, estimateAed: number, n: number): Promise<BulkUpsell> {
    const [remainingAed, canTopUp] = await Promise.all([
      this.deps.remainingAllowanceAed(userId),
      this.deps.canTopUp(userId),
    ]);
    return buildUpsell({ estimateAed, remainingAed, canTopUp, n }, this.deps.topUpOptions);
  }

  /** On the batch result: n chats failed at the limit — offer top-ups (or Subscribe for a trial). */
  async forResult(userId: string, limitedCount: number): Promise<BulkUpsell> {
    const canTopUp = await this.deps.canTopUp(userId);
    return buildUpsell({ estimateAed: 1, remainingAed: 0, canTopUp, n: limitedCount }, this.deps.topUpOptions);
  }
}
