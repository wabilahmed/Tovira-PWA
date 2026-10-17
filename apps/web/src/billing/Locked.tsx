/**
 * The one consistent locked state (P5-1/P5-2). Shown on every premium surface
 * when the account isn't entitled — a calm sentence + a Subscribe action, never a raw
 * error or a broken screen. Capture, Settings, Billing, export and delete stay
 * open elsewhere; this only replaces the gated features.
 */
import { SubscribeNow } from './SubscribeUpsell.js';
import type { Plan } from './plans.js';

/** [P16-3a] The lock copy depends on WHY the account is locked. An account that never had a trial
 *  (status 'none') never had one to "end", so "Your trial has ended" is wrong and confusing — it gets an
 *  invitation to start. A genuinely expired trial keeps the trial-ended wording; an ended/cancelled
 *  subscription is phrased as such. Default (unknown) stays the safe trial-ended line. */
function lockCopy(status?: string): string {
  if (status === 'none') return 'Subscribe to start reading your chats.';
  if (status === 'ended' || status === 'canceled') return 'Your subscription has ended. Subscribe to reopen your book.';
  return 'Your trial has ended. Subscribe to reopen your book.';
}

export function Locked({ onSubscribe, status }: { onSubscribe: (plan: Plan) => void; status?: string }): JSX.Element {
  return (
    <section
      aria-label="Subscribe to continue"
      role="status"
      style={{ border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)', background: 'var(--surface-raised)', padding: '1.5rem', display: 'grid', gap: '0.75rem', justifyItems: 'center' }}
    >
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{lockCopy(status)}</p>
      {/* [P11-1] Subscribe now + the allowance-reset reassurance — the same treatment as every exhausted upsell. */}
      <SubscribeNow onSubscribe={onSubscribe} />
    </section>
  );
}
