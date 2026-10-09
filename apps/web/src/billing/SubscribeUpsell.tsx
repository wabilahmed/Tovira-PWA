/**
 * [P11-1] The trial rep's way out of an exhausted-allowance dead end. A trial has no card on file, so
 * top-ups (which charge a card) can't be offered — but the rep has just seen the product work on their
 * real chats, so showing them nothing is the worst possible moment. Instead: one clear "Subscribe now"
 * that goes to checkout, with the true reassurance that conversion resets the allowance.
 *
 * Used everywhere an exhausted upsell can render for a trial rep: the usage meter, bulk import, single
 * import, and the locked surfaces — so the copy is identical in all of them.
 */

/** The reassurance line. AED 60 is DEFAULT_MONTHLY_AI_ALLOWANCE_AED (apps/api/src/config.ts) — the
 *  published subscription allowance; conversion resets a trial's used allowance to the full month. */
export const ALLOWANCE_RESET_LINE = 'Subscribing resets your AI allowance to the full AED 60.';

export function SubscribeNow({ onSubscribe, cta = 'Subscribe now' }: { onSubscribe?: () => void; cta?: string }): JSX.Element {
  return (
    <div data-testid="subscribe-upsell" style={{ display: 'grid', gap: '0.4rem', justifyItems: 'start' }}>
      <button type="button" className="tov-primary" data-testid="subscribe-now" onClick={() => onSubscribe?.()}>{cta}</button>
      <small style={{ color: 'var(--text-secondary)' }}>{ALLOWANCE_RESET_LINE}</small>
    </div>
  );
}
