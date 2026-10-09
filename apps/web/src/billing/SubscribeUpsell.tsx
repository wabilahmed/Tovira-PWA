/**
 * [P11-1] The trial rep's way out of an exhausted-allowance dead end. A trial has no card on file, so
 * top-ups (which charge a card) can't be offered — but the rep has just seen the product work on their
 * real chats, so showing them nothing is the worst possible moment. Instead: the two subscription
 * plans, each going straight to checkout, with the true reassurance that conversion resets the allowance.
 *
 * Used everywhere an exhausted upsell can render for a trial rep: the usage meter, bulk import, single
 * import, and the locked surfaces — so the copy and prices are identical in all of them. Prices come
 * from the shared PLANS source (apps/web/src/billing/plans.ts), never hardcoded here.
 */
import { PLANS, type Plan } from './plans.js';

/** The reassurance line. AED 60 is DEFAULT_MONTHLY_AI_ALLOWANCE_AED (apps/api/src/config.ts) — the
 *  published monthly allowance; conversion resets a trial's used allowance to the full month. */
export const ALLOWANCE_RESET_LINE = 'Subscribing resets your AI allowance to the full AED 60.';

export function SubscribeNow({ onSubscribe }: { onSubscribe?: (plan: Plan) => void }): JSX.Element {
  return (
    <div data-testid="subscribe-upsell" style={{ display: 'grid', gap: '0.5rem', justifyItems: 'start' }}>
      {/* Yearly is the primary action (the better deal); monthly is the secondary. */}
      <button
        type="button"
        className="tov-primary"
        data-testid="subscribe-annual"
        style={{ maxWidth: '100%', whiteSpace: 'normal' }}
        onClick={() => onSubscribe?.(PLANS.annual.id)}
      >
        {PLANS.annual.price} · {PLANS.annual.save}
      </button>
      <button
        type="button"
        data-testid="subscribe-monthly"
        style={{ maxWidth: '100%', whiteSpace: 'normal' }}
        onClick={() => onSubscribe?.(PLANS.monthly.id)}
      >
        {PLANS.monthly.price}
      </button>
      <small style={{ color: 'var(--text-secondary)' }}>{ALLOWANCE_RESET_LINE}</small>
    </div>
  );
}
