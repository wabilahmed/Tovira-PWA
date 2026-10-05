import { useEffect, useState, type FormEvent, type JSX } from 'react';
import type { AuthClient } from './authClient.js';

/** [BETA-6] The invite page: validate the token, set a password, and accept the terms. Reached at
 *  /invite?token=… (served by the SPA before the session gate, like /reset-password). */
export function InviteAccept({ auth, token, onDone }: { auth: AuthClient; token: string; onDone: () => void }): JSX.Element {
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [termsVersion, setTermsVersion] = useState('');
  const [privacyVersion, setPrivacyVersion] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // [BETA-8] expired-link recovery state
  const [resending, setResending] = useState(false);
  const [resendResult, setResendResult] = useState<'sent' | 'rate_limited' | 'error' | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    void auth.inviteStatus(token).then((s) => {
      setValid(s.valid);
      setTermsVersion(s.termsVersion);
      setPrivacyVersion(s.privacyVersion);
      setChecking(false);
    });
  }, [auth, token]);

  if (checking) return <main className="auth-card">Checking your invitation…</main>;

  // [BETA-8] An expired/invalid/used link lands here. We can't (and must not) reveal which — so we offer
  // to send a fresh link to the ORIGINAL invited address. The token carries the identity; no address is
  // entered here, so the button can't redirect the invite. The server answers identically whether or not
  // the invite is still open, so the confirmation below is deliberately neutral (anti-enumeration).
  if (!valid && !done) {
    async function onResend(): Promise<void> {
      setResending(true);
      const res = await auth.resendInvite(token);
      setResending(false);
      if (res.ok) { setResendResult('sent'); setResendMessage(null); }
      else if (res.rateLimited) { setResendResult('rate_limited'); setResendMessage(res.message ?? null); }
      else { setResendResult('error'); setResendMessage(res.message ?? null); }
    }
    return (
      <main className="auth-card" aria-live="polite">
        <h1>This link has expired</h1>
        {resendResult === 'sent' ? (
          <p>If this invitation is still open, we’ve sent a new link to the email address this invite was sent to. Check your inbox and spam folder.</p>
        ) : resendResult === 'rate_limited' ? (
          <p className="auth-error" role="alert">{resendMessage ?? 'We’ve already sent a few links today. Check your inbox and spam folder, or contact hello@tovira.io.'}</p>
        ) : (
          <>
            <p>We can send a new one to the email address this invite was sent to.</p>
            {resendResult === 'error' && <p className="auth-error" role="alert">{resendMessage ?? 'Could not send a new link. Please try again.'}</p>}
            <button type="button" onClick={() => void onResend()} disabled={resending}>{resending ? 'Sending…' : 'Send a new link'}</button>
          </>
        )}
      </main>
    );
  }

  if (done) {
    return (
      <main className="auth-card" aria-live="polite">
        <h1>Your account is ready</h1>
        <p>Your password is set and your account is active. You can now log in.</p>
        <button type="button" onClick={onDone}>Go to Tovira</button>
      </main>
    );
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!accepted) {
      setError('Please accept the Terms and Privacy Policy to continue.');
      return;
    }
    setBusy(true);
    const res = await auth.acceptInvite(token, password, accepted);
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(res.message ?? 'Could not set up your account.');
  }

  return (
    <main className="auth-card">
      <h1>Set up your Tovira account</h1>
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <label>
          Choose a password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
        </label>
        <label className="auth-confirm">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          I have read and accept the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and{' '}
          <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>
          {termsVersion ? ` (version ${termsVersion}${privacyVersion && privacyVersion !== termsVersion ? ` / ${privacyVersion}` : ''})` : ''}.
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || !accepted}>{busy ? 'Setting up…' : 'Set password and continue'}</button>
      </form>
    </main>
  );
}
