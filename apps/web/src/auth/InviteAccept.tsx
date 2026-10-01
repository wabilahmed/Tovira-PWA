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

  useEffect(() => {
    void auth.inviteStatus(token).then((s) => {
      setValid(s.valid);
      setTermsVersion(s.termsVersion);
      setPrivacyVersion(s.privacyVersion);
      setChecking(false);
    });
  }, [auth, token]);

  if (checking) return <main className="auth-card">Checking your invitation…</main>;

  if (!valid && !done) {
    return (
      <main className="auth-card">
        <h1>This invitation can’t be used</h1>
        <p>The link is invalid, has expired, or has already been used. If you think this is a mistake, reply to your invitation email and we’ll help.</p>
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
