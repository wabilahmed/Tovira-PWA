import './auth.css';

/**
 * The branded frame shared by every auth screen (log in / sign up / forgot /
 * reset). A single centred card on the Ledger canvas with a soft terracotta glow
 * — the wordmark, the tagline, a per-screen subtitle, then the form. One <h1> per
 * screen (only one auth screen renders at a time).
 */
export function AuthShell({ subtitle, children }: { subtitle?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="auth">
      <div className="auth__bg" aria-hidden="true" />
      <div className="auth__card">
        <a className="auth__home" href="/">← Back to home</a>
        <h1 className="auth__wordmark">Tovira</h1>
        <p className="auth__tagline">Your deal, Our memory, Instant success.</p>
        {subtitle && <p className="auth__subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
