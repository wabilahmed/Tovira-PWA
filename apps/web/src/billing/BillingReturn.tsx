import { useEffect, useRef, useState, type JSX } from 'react';
import { AuthShell } from '../auth/AuthShell.js';
import type { BillingClient } from './billingClient.js';

function queryParam(name: string): string {
  try {
    return new URLSearchParams(window.location.search).get(name) ?? '';
  } catch {
    return '';
  }
}

/** The plan the rep just bought, from the success URL (?plan=…), for the confirmation copy. */
function planLabel(): string {
  const p = queryParam('plan');
  return p === 'annual' ? 'Yearly' : p === 'monthly' ? 'Monthly' : '';
}

/**
 * [BILL-13] The Stripe return pages. A rep must never land on a 404 after paying.
 *  - success: poll billing status until the webhook has marked the account active (~10s), showing
 *    "Confirming your payment…"; then "You're subscribed" → Today. If it hasn't flipped by then, say
 *    "Payment received — your account will update in a moment." and keep polling in the background.
 *  - cancel: "Checkout cancelled. You haven't been charged." → Settings.
 * The URL alone is never trusted — only the server's billing status is.
 */
export function BillingReturn({
  mode,
  billing,
  pollMs = 1000,
  maxTries = 10,
  onNavigate = (url: string) => { try { window.location.assign(url); } catch { /* jsdom */ } },
}: {
  mode: 'success' | 'cancel';
  billing: Pick<BillingClient, 'status' | 'confirmSuccess'>;
  pollMs?: number;
  maxTries?: number;
  onNavigate?: (url: string) => void;
}): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const alive = useRef(true);

  const isTopUp = mode === 'success' && queryParam('topup') === '1';

  // [P37] Back from a top-up checkout: straight to Settings → Subscription, which says "Updating your balance…"
  // until the webhook has credited it (never a claim that it's already there).
  useEffect(() => {
    if (isTopUp) onNavigate('/app?view=settings&topup=1');
  }, []);

  useEffect(() => {
    if (mode !== 'success' || isTopUp) return; // a top-up doesn't flip subscription status — nothing to confirm
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    // [P16-3b] With NO session_id there is nothing to confirm and nothing to wait for — show the neutral
    // state immediately instead of polling billing status for ~20s. Only a real session_id is worth
    // confirming + the webhook-in-flight poll below.
    const sessionId = queryParam('session_id');
    if (!sessionId) { setUnconfirmed(true); return () => { alive.current = false; }; }
    void (async () => {
      // [P14-4a] AUTHORITATIVE: confirm THIS session server-side. The server retrieves it from Stripe and
      // activates only when it is PAID and belongs to this rep — so we say "subscribed" on real proof, and
      // NEVER say "payment received" just because the browser landed on this URL.
      const confirm = await billing.confirmSuccess(sessionId).catch(() => null);
      if (!alive.current) return;
      if (confirm?.paid || confirm?.entitlement?.status === 'active') { setConfirmed(true); return; }
      // Fallback: the webhook may still be in flight (or this is an old link with no session_id). Poll
      // the real billing status a few times; only an ACTIVE status confirms. Otherwise we send the rep to
      // Settings with a neutral message — never a claimed payment.
      let tries = 0;
      const tick = async (): Promise<void> => {
        if (!alive.current) return;
        const ent = await billing.status().catch(() => null);
        if (!alive.current) return;
        if (ent?.status === 'active') { setConfirmed(true); return; }
        if (++tries >= maxTries) { setUnconfirmed(true); return; }
        timer = setTimeout(() => void tick(), pollMs);
      };
      await tick();
    })();
    return () => { alive.current = false; clearTimeout(timer); };
  }, [mode, billing, isTopUp, pollMs, maxTries]);

  if (mode === 'cancel') {
    return (
      <AuthShell subtitle="Checkout cancelled">
        <p className="auth__intro" role="status">Checkout cancelled. You haven&apos;t been charged.</p>
        <button className="auth__submit" type="button" onClick={() => onNavigate('/app?view=settings')}>Back to Settings</button>
      </AuthShell>
    );
  }

  if (isTopUp) {
    return (
      <AuthShell subtitle="Payment received">
        <p className="auth__intro" role="status">Thanks. Updating your balance…</p>
        <button className="auth__submit" type="button" onClick={() => onNavigate('/app?view=settings&topup=1')}>Back to Subscription</button>
      </AuthShell>
    );
  }

  if (confirmed) {
    const plan = planLabel();
    return (
      <AuthShell subtitle="You're subscribed">
        <p className="auth__intro" role="status">You&apos;re subscribed{plan ? ` to the ${plan} plan` : ''}. Welcome aboard.</p>
        <button className="auth__submit" type="button" onClick={() => onNavigate('/app?view=today')}>Go to Today</button>
      </AuthShell>
    );
  }

  // [P14-4a] We could NOT confirm a payment on this link (no/other/unpaid session, and status never
  // flipped). Never claim "payment received" — send the rep to Settings with a calm, honest message.
  if (unconfirmed) {
    return (
      <AuthShell subtitle="Nothing to confirm here">
        <p className="auth__intro" role="status">
          We couldn&apos;t confirm a payment from this link. If you just subscribed, your account will update shortly — you can check or manage your subscription in Settings.
        </p>
        <button className="auth__submit" type="button" onClick={() => onNavigate('/app?view=settings')}>Go to Settings</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="Confirming your payment…">
      <p className="auth__intro" role="status">Confirming your payment…</p>
    </AuthShell>
  );
}
