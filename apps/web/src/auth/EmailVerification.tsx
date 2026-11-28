import { useEffect, useState } from 'react';
import { AuthShell } from './AuthShell.js';

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

  // [P90 · owner, Prompt 88, batch 1] 010 and 011: the same full-page layout as every signed-out screen (the logo, one
  // heading, one line, one button). The server's own message stays for a screen reader's ears only where it adds
  // nothing new; the heading and line are the owner's.
  if (state === 'pending') return <AuthShell heading="Confirming your email…" centered><p className="auth__status" role="status">One moment.</p></AuthShell>;
  if (state === 'ok') {
    return (
      <AuthShell heading="Your email is confirmed. Thank you." centered>
        <button className="auth__submit" onClick={onDone}>Continue to Tovira</button>
      </AuthShell>
    );
  }
  return (
    <AuthShell heading="That link has run out." centered>
      <p className="auth__status" role="alert" data-reason={message ?? undefined}>You can ask for a new one from Settings once you&apos;re signed in.</p>
      <button className="auth__submit" onClick={onDone}>Continue to Tovira</button>
    </AuthShell>
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
