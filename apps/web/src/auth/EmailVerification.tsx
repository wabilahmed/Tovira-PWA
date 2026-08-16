import { useEffect, useState } from 'react';

export interface VerifyApi {
  verifyEmail(token: string): Promise<{ ok: boolean; message?: string }>;
  resendVerification(): Promise<{ ok: boolean; rateLimited?: boolean; message?: string }>;
}

/**
 * Landing page for the emailed confirmation link (reached at
 * /verify-email?token=…). Verifies once on mount; access is never gated on the
 * result — this only flips the "confirmed" state.
 */
export function VerifyEmailPage({ api, token, onDone }: { api: VerifyApi; token: string; onDone: () => void }): JSX.Element {
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.verifyEmail(token).then((r) => {
      if (!live) return;
      if (r.ok) setState('ok');
      else {
        setState('error');
        setMessage(r.message ?? 'This verification link is invalid or has expired.');
      }
    });
    return () => {
      live = false;
    };
  }, [api, token]);

  if (state === 'pending') return <section aria-label="Confirming email"><p role="status">Confirming your email…</p></section>;
  if (state === 'ok') {
    return (
      <section aria-label="Email confirmed">
        <p role="status">Your email is confirmed. Thank you.</p>
        <button className="tov-primary" onClick={onDone}>Continue to Tovira</button>
      </section>
    );
  }
  return (
    <section aria-label="Verification failed">
      <p role="alert" style={{ color: 'var(--claret)' }}>{message}</p>
      <p>You can ask for a new link from Settings once you are signed in.</p>
      <button className="tov-primary" onClick={onDone}>Continue to Tovira</button>
    </section>
  );
}

/**
 * Quiet, dismissible in-app nudge for an unverified account (EMAIL-VERIFY). It
 * never blocks anything — the rep has full access. Offers a single Resend action
 * (server-rate-limited) and can be dismissed for the session.
 */
export function VerifyBanner({ api, onDismiss }: { api: VerifyApi; onDismiss?: () => void }): JSX.Element {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resend(): Promise<void> {
    setBusy(true);
    const r = await api.resendVerification();
    setBusy(false);
    if (r.ok) setStatus('Sent. Check your inbox for the confirmation link.');
    else if (r.rateLimited) setStatus('You have asked for too many today. Try again tomorrow.');
    else setStatus(r.message ?? 'Could not send the email. Please try again.');
  }

  return (
    <div className="tov-verify-banner" role="status" aria-label="Confirm your email">
      <span>Confirm your email so we can reach you about your trial.</span>
      <span className="tov-verify-banner__actions">
        <button className="tov-link" type="button" onClick={resend} disabled={busy}>
          {busy ? 'Sending…' : 'Resend'}
        </button>
        {onDismiss && (
          <button className="tov-link" type="button" aria-label="Dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </span>
      {status && <p className="tov-verify-banner__status">{status}</p>}
    </div>
  );
}
