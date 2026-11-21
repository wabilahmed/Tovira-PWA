/**
 * [BULK-IMPORT · RULING 2 → P83 · owner, 21 Nov] The pack upsell shown (a) on the review screen before Import when the
 * batch has more messages to read than the rep has left, and (b) on the batch result when chats waited at the limit.
 * Everything is in messages: the packs are named "+1,500 messages", and the smallest pack that covers the shortfall is
 * highlighted. No price is in it: prices appear only on the purchase screen and at checkout.
 */
import type { TopUpOption } from '../../config.js';

/** A pack as the upsell names it: its messages, never its price. */
export interface PackChoice {
  id: string;
  label: string;
  messages: number;
}

export interface BulkUpsell {
  /** The batch has more messages to read than are left (before Import), or chats waited at the limit (result). */
  shortfall: boolean;
  /** The number the copy speaks about: importable chats (review) or chats that waited (result). */
  n: number;
  /** false for a trial account → the web shows "Subscribe to keep importing" instead of packs. */
  canTopUp: boolean;
  options: PackChoice[];
  /** The smallest pack that covers the shortfall: highlighted. Null when there is no shortfall, or on a trial. */
  recommendedOptionId: string | null;
  /** Before Import: the batch's messages to read and the messages left. */
  messagesToRead?: number;
  messagesLeft?: number;
}

const choice = (o: TopUpOption): PackChoice => ({ id: o.id, label: o.label, messages: o.messages });

/** The smallest pack whose messages cover the shortfall; the largest if none does; null with no packs. */
export function pickPack(shortMessages: number, options: readonly TopUpOption[]): TopUpOption | null {
  if (options.length === 0) return null;
  const bySize = [...options].sort((a, b) => a.messages - b.messages);
  return bySize.find((o) => o.messages >= shortMessages) ?? bySize[bySize.length - 1]!;
}

export function buildUpsell(
  input: { messagesToRead: number; messagesLeft: number; canTopUp: boolean; n: number; result?: boolean },
  options: readonly TopUpOption[],
): BulkUpsell {
  const shortfall = input.result === true || input.messagesToRead > input.messagesLeft;
  const canOffer = input.canTopUp && options.length > 0;
  const recommended = shortfall && canOffer ? pickPack(Math.max(1, input.messagesToRead - input.messagesLeft), options) : null;
  return {
    shortfall,
    n: input.n,
    canTopUp: input.canTopUp,
    options: canOffer ? options.map(choice) : [],
    recommendedOptionId: recommended ? recommended.id : null,
    ...(input.result ? {} : { messagesToRead: input.messagesToRead, messagesLeft: input.messagesLeft }),
  };
}

export interface BulkUpsellDeps {
  topUpOptions: readonly TopUpOption[];
  /** The rep's messages left (the month's, then packs). */
  messagesLeft: (userId: string) => Promise<number>;
  /** A paying subscriber can buy packs; a trial cannot (→ Subscribe). */
  canTopUp: (userId: string) => Promise<boolean>;
}

export class BulkUpsellService {
  constructor(private readonly deps: BulkUpsellDeps) {}

  /** Before Import: does this batch have more messages to read than the rep has left? */
  async forBatch(userId: string, messagesToRead: number, n: number): Promise<BulkUpsell> {
    const [messagesLeft, canTopUp] = await Promise.all([this.deps.messagesLeft(userId), this.deps.canTopUp(userId)]);
    return buildUpsell({ messagesToRead, messagesLeft, canTopUp, n }, this.deps.topUpOptions);
  }

  /** On the batch result: n chats waited at the limit. Offer packs (or Subscribe for a trial). */
  async forResult(userId: string, limitedCount: number): Promise<BulkUpsell> {
    const canTopUp = await this.deps.canTopUp(userId);
    return buildUpsell({ messagesToRead: 1, messagesLeft: 0, canTopUp, n: limitedCount, result: true }, this.deps.topUpOptions);
  }
}
