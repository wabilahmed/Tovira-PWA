import { useState } from 'react';
import { AuthShell } from './AuthShell.js';

export interface ResetApi {
  forgotPassword(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<{ ok: boolean; message?: string }>;
}

/**
 * Request a reset link (TASK EMAIL). The confirmation copy is identical whether
 * or not the email has an account — the UI never reveals existence.
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
      <AuthShell subtitle="Check your inbox">
        <p className="auth__status" role="status">If that email has an account, a reset link is on its way. It expires in an hour.</p>
        <button className="auth__submit" onClick={onBack}>Back to log in</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="Reset your password">
      <form onSubmit={submit} className="auth__form" aria-label="Forgot password">
        <p className="auth__status">Enter your email and we'll send a link to set a new password.</p>
        <label className="auth__field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <button className="auth__submit" type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <div className="auth__alt">
        <button className="auth__link auth__link--muted" type="button" onClick={onBack}>Back to log in</button>
      </div>
    </AuthShell>
  );
}

/** Set a new password from an emailed link (reached at /reset-password?token=…). */
export function ResetPassword({ api, token, onDone }: { api: ResetApi; token: string; onDone: () => void }): JSX.Element {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api.resetPassword(token, password);
    setBusy(false);
    if (result.ok) setDone(true);
    else setError(result.message ?? 'Could not reset your password.');
  }

  if (done) {
    return (
      <AuthShell subtitle="Password updated">
        <p className="auth__status" role="status">Your password has been updated. You can log in now.</p>
        <button className="auth__submit" onClick={onDone}>Go to log in</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="Set a new password">
      <form onSubmit={submit} className="auth__form" aria-label="Reset password">
        <p className="auth__status">Choose a new password for your Tovira account.</p>
        <label className="auth__field">
          <span>New password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
        </label>
        {error && <p className="auth__error" role="alert">{error}</p>}
        <button className="auth__submit" type="submit" disabled={busy || password.length < 8}>
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthShell>
  );
}
