import { useState } from 'react';
import { AuthAlert, AuthShell } from './AuthShell.js';
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
export function LoginScreen({ auth, onAuthed, signupEnabled = true, referralsEnabled = false, initialMode = 'login' }: { auth: AuthClient; onAuthed: (s: Session) => void; signupEnabled?: boolean; /** [P90] 'forgot' opens on the forgot-password screen (from an expired reset link) */ initialMode?: 'login' | 'forgot'; /** [P46-3] REFERRALS_ENABLED: off hides the field and the outcome; a ?ref= code still rides along */ referralsEnabled?: boolean }): JSX.Element {
  // [INV-12] When self-serve signup is off (invite-only beta), never offer the "Sign up" toggle or the
  // signup form — the API 404s signup, so a visible path to it is a dead end. Point to beta access instead.
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [refCode, setRefCode] = useState(refFromUrl);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // [P90] a log-in the server refused for its credentials: one message that never says which of the two was wrong
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  // After a signup that carried a code, hold the created session while we show the outcome message.
  const [done, setDone] = useState<{ session: Session; referral: 'applied' | 'invalid' } | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (mode === 'signup' && !consent) return; // must accept the terms to sign up
    setBusy(true);
    setError(null);
    setMismatch(false);
    try {
      const code = refCode.trim();
      const session = mode === 'login'
        ? await auth.login(email, password)
        : await auth.signup(email, password, code || undefined, true);
      // The account is created. If a code was processed, show its outcome before continuing; otherwise
      // go straight in (no code, no extra step).
      if (referralsEnabled && mode === 'signup' && (session.referral === 'applied' || session.referral === 'invalid')) {
        setDone({ session, referral: session.referral });
      } else {
        onAuthed(session);
      }
    } catch (err) {
      const e = err as { code?: string | null; status?: number };
      if (mode === 'login' && (e.code === 'invalid_credentials' || e.status === 401)) setMismatch(true);
      else setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  // Post-signup referral outcome — the account IS created; this only reports whether the code applied.
  if (done) {
    return (
      <AuthShell heading="You're in.">
        <div className="auth__form">
          <p role="status" className={done.referral === 'invalid' ? 'auth__error' : undefined}>
            {done.referral === 'applied'
              ? '🎉 Referral applied. Your referrer earns a free month.'
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
    <AuthShell
      heading={mode === 'login' ? 'Welcome back.' : 'Create your account'}
      lead={mode === 'login' ? "Let's see what your clients have been telling you." : undefined}
    >
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
        {/* [P90] under the password field, right-aligned; it gives way to the alert, which carries the same way out */}
        {mode === 'login' && !mismatch && (
          <button type="button" className="auth__link auth__link--end" onClick={() => setMode('forgot')}>Forgot password?</button>
        )}
        {referralsEnabled && mode === 'signup' && (
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
              {/* [P22-1] our own pages, same origin — never an absolute domain */}
              <a href="/terms" target="_blank" rel="noopener">Terms</a> and{' '}
              <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
            </span>
          </label>
        )}
        {mismatch && (
          <AuthAlert>
            That email and password don&apos;t match. Try again, or{' '}
            <button type="button" className="auth__link" onClick={() => setMode('forgot')}>reset your password</button>.
          </AuthAlert>
        )}
        {error && <AuthAlert>{error}</AuthAlert>}
        <button className="auth__submit" type="submit" disabled={busy || (mode === 'signup' && !consent)}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
      {mode === 'signup' && <p className="auth__trust">14 days free · no card to start</p>}
      {signupEnabled ? (
        <p className="auth__foot">
          <button type="button" className="auth__link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}
          </button>
        </p>
      ) : (
        // [INV-12] Invite-only beta: send them to request access, not to a dead-end signup form.
        <p className="auth__foot">New here? <a className="auth__link" href="/request-access" data-testid="request-access-link">Request access</a></p>
      )}
    </AuthShell>
  );
}
