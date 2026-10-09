import { useEffect, useState } from 'react';
import type { Entitlement } from './billingClient.js';
import { formatStamp } from '../format/dates.js';
import { PLANS } from './plans.js';

export interface BillingApi {
  status(): Promise<Entitlement | null>;
  checkout(plan: 'monthly' | 'annual'): Promise<string | null>;
  /** [TASK 3] Open the Stripe Customer Portal (manage subscription). Null when unavailable. */
  portal(): Promise<string | null>;
}

const DAY = 24 * 60 * 60 * 1000;

/** Trial + subscription surface (P5-1/P5-2). Access is decided server-side by
 *  webhooks; this reads status and starts Stripe Checkout. */
export function Billing({
  api,
  now = Date.now(),
  onRedirect = (url) => {
    window.location.href = url;
  },
}: {
  api: BillingApi;
  now?: number;
  onRedirect?: (url: string) => void;
}): JSX.Element {
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.status().then((e) => {
      if (!live) return;
      setEnt(e);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [api]);

  async function subscribe(plan: 'monthly' | 'annual'): Promise<void> {
    setBusy(true);
    setError(null);
    const url = await api.checkout(plan);
    setBusy(false);
    if (url) onRedirect(url);
    else setError('Could not start checkout — please try again.');
  }

  async function manage(): Promise<void> {
    setBusy(true);
    setError(null);
    const url = await api.portal();
    setBusy(false);
    if (url) onRedirect(url);
    else setError('Could not open the billing portal — please try again.');
  }

  if (loading) return <p>Loading your plan…</p>;

  const status = ent?.status ?? 'none';
  const daysLeft = ent ? Math.max(0, Math.ceil((ent.trialEndsAt - now) / DAY)) : 0;

  return (
    <section aria-label="Billing">
      <h2 style={{ marginTop: 0 }}>Your plan</h2>
      {status === 'active' ? (
        <>
          <p>You're subscribed. Thank you for keeping your book with Tovira.</p>
          {ent?.renewsAt != null && (
            <p data-testid="renews-at">Renews <span className="tov-mono">{formatStamp(ent.renewsAt)}</span></p>
          )}
          {/* [TASK 3] Manage subscription via the Stripe Customer Portal: cancel (at period end), update
              the card, and see past invoices. This is what makes "cancel anytime from Billing" true. */}
          <button className="tov-link" onClick={() => void manage()} disabled={busy}>
            {busy ? 'Opening…' : 'Manage subscription'}
          </button>
        </>
      ) : status === 'trialing' ? (
        <p data-testid="trial-status">Free trial — <span className="tov-mono">{daysLeft}</span> day{daysLeft === 1 ? '' : 's'} left.</p>
      ) : status === 'past_due' ? (
        <p data-testid="past-due" style={{ color: 'var(--amber)' }}>Your last payment failed. Update billing to keep access.</p>
      ) : status === 'canceled' ? (
        <p data-testid="canceled">Your subscription is canceled. Your book is preserved — resubscribe to reopen it.</p>
      ) : (
        <p data-testid="expired">Your trial has ended. Subscribe to keep your memory bank.</p>
      )}

      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}

      {status !== 'active' && (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="tov-primary" onClick={() => void subscribe('monthly')} disabled={busy}>
              {busy ? 'Starting…' : <>Subscribe monthly — <span className="tov-mono">{PLANS.monthly.price}</span></>}
            </button>
            <button className="tov-link" onClick={() => void subscribe('annual')} disabled={busy}>
              {busy ? 'Starting…' : <>Subscribe annually — <span className="tov-mono">{PLANS.annual.price}</span> (2 months free)</>}
            </button>
          </div>
          {/* [TASK 3] Checkout disclosure beside the plans. Grounded in the real behaviour: prices are
              VAT-inclusive (VAT is decomposed out, never added on top — vat.ts); subscriptions renew at
              the same date and time (Terms 6.3); you can cancel anytime from Billing via the Customer
              Portal; and access continues until the end of the paid period (Terms 6.5). */}
          <p data-testid="checkout-disclosure" className="standard" style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Prices are in AED and include VAT. Your subscription renews automatically at the same date and
            time each period — monthly plans each month, yearly plans each year — until you cancel. Your plan
            includes a monthly allowance of AI processing; you can buy more anytime. You can cancel anytime
            from Billing; your access continues until the end of the period you have paid for.{' '}
            <a href="/terms" target="_blank" rel="noopener">See Terms</a>.
          </p>
        </>
      )}
    </section>
  );
}
