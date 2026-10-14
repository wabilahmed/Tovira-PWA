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
  billing: Pick<BillingClient, 'status'>;
  pollMs?: number;
  maxTries?: number;
  onNavigate?: (url: string) => void;
}): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const alive = useRef(true);

  const isTopUp = mode === 'success' && queryParam('topup') === '1';

  useEffect(() => {
    if (mode !== 'success' || isTopUp) return; // a top-up doesn't flip subscription status — nothing to poll
    alive.current = true;
    let tries = 0;
    let fast: ReturnType<typeof setTimeout>;
    let slow: ReturnType<typeof setInterval>;
    const check = async (): Promise<boolean> => {
      const ent = await billing.status().catch(() => null);
      if (ent?.status === 'active') { if (alive.current) setConfirmed(true); return true; }
      return false;
    };
    const tick = async (): Promise<void> => {
      if (!alive.current || await check()) return;
      if (++tries >= maxTries) {
        if (alive.current) setTimedOut(true);
        slow = setInterval(() => void check().then((ok) => { if (ok) clearInterval(slow); }), 5000); // keep polling
        return;
      }
      fast = setTimeout(() => void tick(), pollMs);
    };
    void tick();
    return () => { alive.current = false; clearTimeout(fast); clearInterval(slow); };
  }, [mode, billing, pollMs, maxTries]);

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
      <AuthShell subtitle="Top-up added">
        <p className="auth__intro" role="status">Your top-up has been added. It&apos;s ready to use now.</p>
        <button className="auth__submit" type="button" onClick={() => onNavigate('/app?view=today')}>Go to Today</button>
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

  return (
    <AuthShell subtitle={timedOut ? 'Payment received' : 'Confirming your payment…'}>
      <p className="auth__intro" role="status">
        {timedOut ? 'Payment received — your account will update in a moment.' : 'Confirming your payment…'}
      </p>
      {timedOut && (
        <button className="auth__submit" type="button" onClick={() => onNavigate('/app?view=today')}>Go to Today</button>
      )}
    </AuthShell>
  );
}
