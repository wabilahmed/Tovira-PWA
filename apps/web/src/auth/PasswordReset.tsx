import { useState } from 'react';

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
      <section aria-label="Reset requested">
        <p role="status">If that email has an account, a reset link is on its way. It expires in an hour.</p>
        <button className="tov-link" onClick={onBack}>Back to log in</button>
      </section>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Forgot password">
      <p>Enter your email and we'll send a link to set a new password.</p>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.5rem' }}>
        <button className="tov-primary" type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
        <button className="tov-link" type="button" onClick={onBack}>Back to log in</button>
      </div>
    </form>
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
      <section aria-label="Password updated">
        <p role="status">Your password has been updated. You can log in now.</p>
        <button className="tov-primary" onClick={onDone}>Go to log in</button>
      </section>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Reset password">
      <p>Choose a new password for your Tovira account.</p>
      <label>
        New password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
      </label>
      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}
      <button className="tov-primary" type="submit" disabled={busy || password.length < 8} style={{ marginTop: '0.5rem' }}>
        {busy ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}
