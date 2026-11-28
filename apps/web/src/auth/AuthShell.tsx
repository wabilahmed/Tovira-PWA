import type { ReactNode } from 'react';
import './auth.css';
import { Logo } from '../components/Logo.js';

/**
 * The frame every signed-out screen shares (log in, request access, password reset, email confirmation, invite, the
 * checkout return pages).
 * [P90 · owner, Prompt 88, batch 1] Marker (plan/screens/batch-1-signed-out.html): no floating card, no tagline and no
 * small sub-heading. The screen is the white page itself: the logo top left, "Home" top right, then ONE large heading
 * (the screen's only h1), an optional sub-line, and the content, with 24px side padding; a 420px column centred on a
 * desktop. `subtitle` is the plain-text heading older callers pass; `heading` takes key words in a <Mark>.
 */
export function AuthShell({ heading, subtitle, lead, step, icon, centered = false, children }: {
  heading?: ReactNode;
  /** A plain-text heading (what used to be the small sub-heading under the logo). */
  subtitle?: string;
  /** The one line under the heading. */
  lead?: ReactNode;
  /** "Step n of 3" and its bar, above the heading. */
  step?: ReactNode;
  /** A decorative icon tile above the heading (confirmation screens). */
  icon?: ReactNode;
  /** Centre the content in the height of the page (confirmations and expired links). */
  centered?: boolean;
  children?: ReactNode;
}): JSX.Element {
  const title = heading ?? subtitle;
  return (
    <div className="auth">
      <div className="auth__col">
        <header className="auth__top">
          <span className="auth__logo"><Logo /></span>
          <a className="auth__home" href="/">Home</a>
        </header>
        <main className={`auth__main${centered ? ' auth__main--centered' : ''}${step ? ' auth__main--steps' : ''}`}>
          {step}
          {icon && <div className="auth__icon" aria-hidden="true">{icon}</div>}
          {title && <h1 className="auth__heading">{title}</h1>}
          {lead && <p className="auth__lead">{lead}</p>}
          {children}
        </main>
      </div>
    </div>
  );
}

/** The Marker highlight: the key words of a heading or one phrase, at most once per screen. Never on a button or input. */
export function Mark({ children }: { children: ReactNode }): JSX.Element {
  return <span className="auth__mk">{children}</span>;
}

/** "Step n of 3" with its three-part bar (the bar is decoration; the label says it). */
export function Steps({ step, of = 3 }: { step: number; of?: number }): JSX.Element {
  return (
    <div className="auth__step">
      <p className="auth__steplabel">{`Step ${step} of ${of}`}</p>
      <div className="auth__bar" aria-hidden="true">{Array.from({ length: of }, (_, i) => <i key={i} className={i < step ? 'on' : undefined} />)}</div>
    </div>
  );
}

/** A black-bordered alert with an icon. Announced (role="alert"). */
export function AuthAlert({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="auth__alert" role="alert">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
      <span>{children}</span>
    </div>
  );
}

export const TickIcon = (): JSX.Element => <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const MailIcon = (): JSX.Element => <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 8l9 6 9-6" /></svg>;
