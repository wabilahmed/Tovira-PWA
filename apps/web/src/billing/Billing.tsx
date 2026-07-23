import { useEffect, useState } from 'react';
import type { Entitlement } from './billingClient.js';

export interface BillingApi {
  status(): Promise<Entitlement | null>;
  checkout(): Promise<string | null>;
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

  async function subscribe(): Promise<void> {
    setBusy(true);
    setError(null);
    const url = await api.checkout();
    setBusy(false);
    if (url) onRedirect(url);
    else setError('Could not start checkout — please try again.');
  }

  if (loading) return <p>Loading your plan…</p>;

  const status = ent?.status ?? 'none';
  const daysLeft = ent ? Math.max(0, Math.ceil((ent.trialEndsAt - now) / DAY)) : 0;

  return (
    <section aria-label="Billing">
      <h2 style={{ marginTop: 0 }}>Your plan</h2>
      {status === 'active' ? (
        <p>You're subscribed. Thanks for using Tovira. ✓</p>
      ) : status === 'trialing' ? (
        <p data-testid="trial-status">Free trial — {daysLeft} day{daysLeft === 1 ? '' : 's'} left.</p>
      ) : status === 'past_due' ? (
        <p data-testid="past-due" style={{ color: '#92400e' }}>Your last payment failed. Update billing to keep access.</p>
      ) : (
        <p data-testid="expired">Your trial has ended. Subscribe to keep your memory bank.</p>
      )}

      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}

      {status !== 'active' && (
        <button onClick={() => void subscribe()} disabled={busy}>
          {busy ? 'Starting…' : 'Subscribe'}
        </button>
      )}
    </section>
  );
}
