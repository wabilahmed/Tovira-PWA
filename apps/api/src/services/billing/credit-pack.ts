import { packGateAed, packMessages, packPriceFils } from '../../config.js';
import type { AiAllowanceRepository } from '../../ports/ai-allowance-repository.js';

/**
 * [P83 · owner, 21 Nov] Credit a pack AFTER Stripe confirms the payment (the webhook), exactly once per event. The
 * messages come from the server-set pack id (a fixed pack, a retired pack, or `custom_<N>`), never from the browser.
 * A custom pack is credited only if Stripe's amount paid equals the server's price for N, so an altered checkout can
 * never buy messages below the price. Each pack also adds AED gate headroom at the plan's ratio, so the money gate
 * never stops a rep who still has paid messages.
 */
export interface CreditPackDeps {
  allowance: AiAllowanceRepository;
  monthlyAllowanceAed: number;
  monthlyMessages: number;
  windowFor: (userId: string) => Promise<{ key: string; startMs: number }>;
  warn?: (message: string) => void;
}

export type CreditPackOutcome = 'credited' | 'replay' | 'unknown_pack' | 'amount_mismatch';

export function createPackCreditor(deps: CreditPackDeps) {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  return async function creditPack(eventId: string, userId: string, optionId: string, amountPaidFils?: number): Promise<CreditPackOutcome> {
    const messages = packMessages(optionId);
    if (messages === null) { warn(`[packs] unknown pack ${optionId} for ${userId}: not credited`); return 'unknown_pack'; }
    if (optionId.startsWith('custom_')) {
      const price = packPriceFils(optionId);
      if (amountPaidFils === undefined || price === null || amountPaidFils !== price) {
        warn(`[packs] custom pack ${optionId} for ${userId}: paid ${amountPaidFils ?? 'unknown'} fils, price ${price ?? 'none'}: not credited`);
        return 'amount_mismatch';
      }
    }
    const w = await deps.windowFor(userId);
    const ok = await deps.allowance.creditTopUpOnce(eventId, userId, w.key, w.startMs, deps.monthlyAllowanceAed,
      packGateAed(messages, deps.monthlyAllowanceAed, deps.monthlyMessages), messages);
    return ok ? 'credited' : 'replay';
  };
}
