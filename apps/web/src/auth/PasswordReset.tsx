import { useState } from 'react';
import { AuthAlert, AuthShell, MailIcon, Mark } from './AuthShell.js';

export interface ResetApi {
  forgotPassword(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<{ ok: boolean; message?: string; expired?: boolean }>;
}

/**
 * Request a reset link (TASK EMAIL). The confirmation copy is identical whether
 * or not the email has an account — the UI never reveals existence.
 * [P90 · owner, Prompt 88, batch 1] 006 "Forgot it? No problem." and 007 "Check your inbox." (the same sub-line, button
 * and message as before; "It expires in an hour." is the screen's one mark).
 */
export function ForgotPassword({ api, onBack }: { api: ResetApi; onBack: () => void }): JSX.Element {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    await api.forgotPassword(email);
    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell heading="Check your inbox." centered icon={<MailIcon />}>
        <p className="auth__status" role="status">If that email has an account, a reset link is on its way. <Mark>It expires in an hour.</Mark></p>
        <button className="auth__link" style={{ alignSelf: 'flex-start' }} type="button" onClick={onBack}>Back to log in</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell heading="Forgot it? No problem." lead="Enter your email and we'll send a link to set a new password.">
      <form onSubmit={submit} className="auth__form" aria-label="Forgot password">
        <label className="auth__field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <button className="auth__submit" type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <button className="auth__link auth__link--center" type="button" onClick={onBack}>Back to log in</button>
    </AuthShell>
  );
}

/**
 * Set a new password from an emailed link (reached at /reset-password?token=…).
 * [P90] 008 "Choose a new password." A link that is invalid, used or expired can only be known when the new password is
 * sent (there is no check to call when the page opens), so 009 "That link has run out." replaces the form then.
 */
export function ResetPassword({ api, token, onDone, onRequestNew }: { api: ResetApi; token: string; onDone: () => void; /** open the forgot-password screen */ onRequestNew?: () => void }): JSX.Element {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api.resetPassword(token, password);
    setBusy(false);
    if (result.ok) setDone(true);
    else if (result.expired) setExpired(true);
    else setError(result.message ?? 'Could not reset your password.');
  }

  if (expired) {
    return (
      <AuthShell heading="That link has run out." centered>
        <p className="auth__status" role="alert">Reset links last an hour and work once. Ask for a new one and you&apos;ll be back in shortly.</p>
        <button className="auth__submit" type="button" onClick={onRequestNew ?? onDone}>Send a new link</button>
        <button className="auth__link auth__link--center" type="button" onClick={onDone}>Back to log in</button>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell heading="Password updated." centered>
        <p className="auth__status" role="status">Your password has been updated. You can log in now.</p>
        <button className="auth__submit" onClick={onDone}>Go to log in</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell heading="Choose a new password." lead="This will be the password for your Tovira account.">
      <form onSubmit={submit} className="auth__form" aria-label="Reset password">
        <label className="auth__field">
          <span>New password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
        </label>
        {error && <AuthAlert>{error}</AuthAlert>}
        <button className="auth__submit" type="submit" disabled={busy || password.length < 8}>
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthShell>
  );
}
