/**
 * The one consistent locked state (P5-1/P5-2). Shown on every premium surface
 * when the account isn't entitled — a calm sentence + a Subscribe action, never a raw
 * error or a broken screen. Capture, Settings, Billing, export and delete stay
 * open elsewhere; this only replaces the gated features.
 */
import { SubscribeNow } from './SubscribeUpsell.js';
import type { Plan } from './plans.js';
import type { Entitlement } from './billingClient.js';
import { Button } from '../ui/Button.js';

/** [P16-3a] The lock copy depends on WHY the account is locked. An account that never had a trial
 *  (status 'none') never had one to "end", so "Your trial has ended" is wrong and confusing — it gets an
 *  invitation to start. A genuinely expired trial keeps the trial-ended wording; an ended/cancelled
 *  subscription is phrased as such. Default (unknown) stays the safe trial-ended line. */
/** [P90-2 · owner, Prompt 88] A paying account locked after a failed payment is told so, never "trial ended"; it updates
 *  its payment details (subscribing again would start a second subscription). */
const PAYMENT_STATES = new Set(['suspended', 'past_due', 'payment_failed']);
function lockCopy(status?: string): string {
  if (status && PAYMENT_STATES.has(status)) return 'Your last payment failed. Update your payment details to reopen your book.';
  if (status === 'none') return 'Subscribe to start analysing your conversations.';
  if (status === 'ended' || status === 'canceled') return 'Your subscription has ended. Subscribe to reopen your book.';
  return 'Your trial has ended. Subscribe to reopen your book.';
}

export function Locked({ onSubscribe, status }: { onSubscribe: (plan: Plan) => void; status?: string }): JSX.Element {
  return (
    <section
      aria-label="Subscribe to continue"
      role="status"
      style={{ border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)', background: 'var(--surface-raised)', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}
    >
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{lockCopy(status)}</p>
      {/* [P11-1] Subscribe now + the allowance-reset reassurance — the same treatment as every exhausted upsell. */}
      {!(status && PAYMENT_STATES.has(status)) && <SubscribeNow onSubscribe={onSubscribe} />}
    </section>
  );
}

/**
 * [P90-2 · owner, Prompt 88] The one panel a suspended or ended account sees in place of every screen but Settings,
 * Subscription and Account (the server refuses everything else): what happened, the way to pay, and the export. The
 * sentences are the payment banner's own.
 */
export function PaymentLocked({ ent, onOpenSubscription, onOpenAccount }: { ent: Entitlement; onOpenSubscription: () => void; onOpenAccount: () => void }): JSX.Element {
  const ended = ent.billingState === 'ended';
  return (
    <section data-testid="payment-locked" role="status" aria-label={ended ? 'Subscription ended' : 'Account suspended'} className="ui-empty">
      <p className="ui-body ui-strong">{ended ? 'Your subscription has ended.' : 'Your account is suspended after a failed payment.'}</p>
      {ended
        ? <p className="ui-secondary">Contact <a href="mailto:hello@tovira.io">hello@tovira.io</a> to restore your account. You can still export your data.</p>
        : <p className="ui-secondary">Update your payment details to restore access. You can still export your data.</p>}
      <div className="ui-cluster ui-gap-3">
        {!ended && (ent.hostedInvoiceUrl
          ? <a className="ui-btn ui-btn--primary" style={{ textDecoration: 'none' }} href={ent.hostedInvoiceUrl}>Update payment details</a>
          : <Button variant="primary" onClick={onOpenSubscription}>Update payment details</Button>)}
        <Button onClick={onOpenAccount}>Export my data</Button>
      </div>
    </section>
  );
}
