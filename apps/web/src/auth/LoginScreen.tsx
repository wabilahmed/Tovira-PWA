import { useState } from 'react';
import { AuthShell } from './AuthShell.js';
import { ForgotPassword } from './PasswordReset.js';
import { AuthClient, type Session } from './authClient.js';

/** The referral code carried in the landing URL (?ref=…), used to prefill the signup field so a rep
 *  who clicked a share link doesn't retype it — but the field stays editable for a code told verbally
 *  or a rep who typed the app URL directly (REFERRAL-ENTRY). */
function refFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('ref')?.trim() ?? '';
}

/**
 * Login / signup / forgot-password. [REFERRAL-ENTRY] Signup shows an optional referral-code field
 * (prefilled from ?ref=, editable) and, after signup, a CLEAR outcome message — applied, or "we
 * couldn't find that code" — because an invalid code must never block signup and the rep deserves to
 * know either way. The account is always created regardless of the code (crediting is isolated
 * server-side); this screen only reports the outcome.
 */
export function LoginScreen({ auth, onAuthed }: { auth: AuthClient; onAuthed: (s: Session) => void }): JSX.Element {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [refCode, setRefCode] = useState(refFromUrl);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // After a signup that carried a code, hold the created session while we show the outcome message.
  const [done, setDone] = useState<{ session: Session; referral: 'applied' | 'invalid' } | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (mode === 'signup' && !consent) return; // must accept the terms to sign up
    setBusy(true);
    setError(null);
    try {
      const code = refCode.trim();
      const session = mode === 'login'
        ? await auth.login(email, password)
        : await auth.signup(email, password, code || undefined, true);
      // The account is created. If a code was processed, show its outcome before continuing; otherwise
      // go straight in (no code, no extra step).
      if (mode === 'signup' && (session.referral === 'applied' || session.referral === 'invalid')) {
        setDone({ session, referral: session.referral });
      } else {
        onAuthed(session);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  // Post-signup referral outcome — the account IS created; this only reports whether the code applied.
  if (done) {
    return (
      <AuthShell subtitle="You're in">
        <div className="auth__form">
          <p role="status" className={done.referral === 'invalid' ? 'auth__error' : undefined}>
            {done.referral === 'applied'
              ? '🎉 Referral applied — your referrer earns a free month.'
              : "We couldn't find that referral code, so no one was credited. Your account is all set."}
          </p>
          <button className="auth__submit" type="button" onClick={() => onAuthed(done.session)}>
            Continue to Tovira
          </button>
        </div>
      </AuthShell>
    );
  }

  if (mode === 'forgot') {
    return <ForgotPassword api={auth} onBack={() => setMode('login')} />;
  }

  return (
    <AuthShell subtitle={mode === 'login' ? 'Log in to your vault' : 'Create your account'}>
      <form onSubmit={submit} className="auth__form" aria-label={mode === 'login' ? 'Log in' : 'Sign up'}>
        <label className="auth__field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="auth__field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {mode === 'signup' && (
          <label className="auth__field">
            <span>Referral code <span style={{ color: 'var(--text-secondary)' }}>(optional)</span></span>
            <input
              type="text"
              value={refCode}
              onChange={(e) => setRefCode(e.target.value)}
              aria-label="Referral code"
              autoComplete="off"
              placeholder="Have a code? Enter it here"
            />
          </label>
        )}
        {mode === 'signup' && (
          <label className="auth__consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-label="Accept terms" />
            <span>
              I agree to the{' '}
              <a href="https://tovira.com/terms" target="_blank" rel="noreferrer">Terms</a> and{' '}
              <a href="https://tovira.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </span>
          </label>
        )}
        {error && <p className="auth__error" role="alert">{error}</p>}
        <button className="auth__submit" type="submit" disabled={busy || (mode === 'signup' && !consent)}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
      <div className="auth__alt">
        <button type="button" className="auth__link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}
        </button>
        {mode === 'login' && (
          <button type="button" className="auth__link auth__link--muted" onClick={() => setMode('forgot')}>
            Forgot password?
          </button>
        )}
      </div>
      {mode === 'signup' && <p className="auth__trust">7 days free · no card to start</p>}
    </AuthShell>
  );
}
