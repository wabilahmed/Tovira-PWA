import './auth.css';
import { Logo } from '../components/Logo.js';

/**
 * The branded frame shared by every auth screen (log in / sign up / forgot /
 * reset). A single centred card on the Ledger canvas with a soft terracotta glow
 * — the wordmark, the tagline, a per-screen subtitle, then the form. One <h1> per
 * screen (only one auth screen renders at a time).
 * [P89 · owner, Prompt 86] Public screens wear the Marker look (data-theme="marker"): the disc logo, no glow or grid.
 */
export function AuthShell({ subtitle, children }: { subtitle?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="auth">
      <div className="auth__bg" aria-hidden="true" />
      <div className="auth__card">
        <a className="auth__home" href="/">← Back to home</a>
        <h1 className="auth__wordmark"><Logo /></h1>
        <p className="auth__tagline">What each client cares about, in front of you when it matters.</p>
        {subtitle && <p className="auth__subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
