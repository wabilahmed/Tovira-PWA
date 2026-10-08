import type { Entitlement } from './billingClient.js';

/**
 * [BILLING-DUNNING · D3/D4/D5/D7] The in-app banner shown on every visit while a payment has failed. It
 * mirrors the failed-payment emails: names the paused AI features (the D3 list) and links straight to the
 * payment page. Plain, factual — no threats, no countdowns. Not shown when active/trialing.
 *
 * The feature list is kept identical to the server's single source (apps/api billing-access.PAUSED_FEATURES
 * — used by the emails and the Terms); if one changes, change both.
 */
const PAUSED_FEATURES = 'importing chats, transcribing voice notes, answering questions about your clients, pre-meeting briefs, client pointers, the daily list and priorities, drafting follow-ups, smart search';

export function PaymentBanner({ ent }: { ent: Entitlement | null }): JSX.Element | null {
  const state = ent?.billingState;
  if (!ent || !state || state === 'active') return null;
  const payUrl = ent.hostedInvoiceUrl ?? undefined;
  const pay = (label: string): JSX.Element =>
    payUrl ? <a href={payUrl} style={{ color: 'inherit', fontWeight: 600 }}>{label}</a> : <>{label} in Settings</>;

  const body =
    state === 'ended' ? (
      <>Your subscription has ended. Contact <a href="mailto:hello@tovira.io" style={{ color: 'inherit', fontWeight: 600 }}>hello@tovira.io</a> to restore your account. You can still export your data.</>
    ) : state === 'suspended' ? (
      <>Your account is suspended after a failed payment. {pay('Update your payment details')} to restore access. You can still export your data.</>
    ) : (
      <>Your last payment failed, so AI features are paused: {PAUSED_FEATURES}. Everything else works, including exporting your data. {pay('Update your payment details')} to resume.</>
    );

  return (
    <div
      data-testid="payment-banner"
      data-state={state}
      role="status"
      style={{ background: 'var(--amber)', color: 'var(--brass-ink)', padding: '0.75rem 1rem', fontSize: '0.9rem', lineHeight: 1.4 }}
    >
      {body}
    </div>
  );
}
