import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthShell, Mark } from './AuthShell.js';
import { LoginScreen } from './LoginScreen.js';
import { ForgotPassword, ResetPassword } from './PasswordReset.js';
import { VerifyEmailPage } from './EmailVerification.js';
import { InviteAccept } from './InviteAccept.js';
import type { AuthClient } from './authClient.js';

/**
 * [P90 · owner, Prompt 88, batch 1] The signed-out screens in the Marker brand (plan/screens/batch-1-signed-out.html):
 * no floating card, no tagline, no small sub-heading; the logo top left, "Home" top right, one large heading per screen.
 * Every route, API call and field is as before.
 */
afterEach(() => { window.history.replaceState({}, '', '/'); });
const heading = () => screen.getByRole('heading', { level: 1 });
const marks = (c: HTMLElement) => [...c.querySelectorAll('.auth__mk')];
const auth = (over: Partial<Record<string, unknown>> = {}): AuthClient => ({
  login: vi.fn(async () => ({ user: { id: 'u1', email: 'a@b.c' } })), signup: vi.fn(), forgotPassword: vi.fn(async () => undefined),
  resetPassword: vi.fn(async () => ({ ok: true })), inviteStatus: vi.fn(async () => ({ valid: true, termsVersion: '2026-11-17', privacyVersion: '2026-11-18' })),
  acceptInvite: vi.fn(async () => ({ ok: true })), resendInvite: vi.fn(async () => ({ ok: true })), ...over,
} as unknown as AuthClient);

describe('[P90] the shell every signed-out screen shares', () => {
  it('the logo, a "Home" link to the landing, one h1 (the heading), then the content', () => {
    const { container } = render(<AuthShell heading="Welcome back." lead="A line."><p>content</p></AuthShell>);
    expect(heading()).toHaveTextContent('Welcome back.');
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(container.querySelector('.tov-logo')).toHaveTextContent('Tovira');
    expect(screen.getByText('A line.')).toBeInTheDocument();
  });
  it('NEGATIVE: no floating card, no tagline, no "Back to home", no small sub-heading under the logo', () => {
    const { container } = render(<AuthShell heading="Welcome back."><p>content</p></AuthShell>);
    expect(container.querySelector('.auth__card, .auth__tagline, .auth__subtitle, .auth__bg')).toBeNull();
    expect(container.textContent).not.toMatch(/What each client cares about|Back to home|Log in to your vault/);
  });
  it('the page is the white page itself: 24px side padding, a 420px column centred on a desktop', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/auth/auth.css'), 'utf8');
    expect(css).toMatch(/\.auth \{[^}]*background: var\(--surface-base\)/);
    expect(css).toMatch(/\.auth \{[^}]*--gutter: 24px;[^}]*--section-gap: 28px;/);
    expect(css).toMatch(/\.auth__col \{[^}]*max-width: calc\(420px \+ 48px\)[^}]*padding: var\(--section-gap\) var\(--gutter\)/);
    expect(css).not.toMatch(/\.auth__card|box-shadow: var\(--shadow-overlay\)|radial-gradient/);
  });
  it('yellow is the marker only: a Mark is a span, never on a button or input; the yellow comes from one token', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/auth/auth.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const uses = [...css.matchAll(/([^{}]+)\{[^}]*var\(--highlight\)[^}]*\}/g)].map((m) => m[1]!.trim());
    expect(uses).toEqual(['.auth__mk']);
    const { container } = render(<p><Mark>key words</Mark></p>);
    expect(container.querySelector('span.auth__mk')).toHaveTextContent('key words');
  });
  it('touch targets are at least 44px: buttons, links, radio rows and the checkbox line', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/auth/auth.css'), 'utf8');
    for (const [sel, min] of [['.auth__submit', 54], ['.auth__back', 54], ['.auth__option', 48], ['.auth__option--pill', 44], ['.auth__link', 44], ['.auth__home', 44], ['.auth__consent', 44], ['.auth__field input', 52]] as const) {
      const rule = new RegExp(`${sel.replace(/[.]/g, '\\.')}(?:,[^{]*)? \\{[^}]*(?:min-height|height): (\\d+)px`).exec(css);
      expect(rule, sel).not.toBeNull();
      expect(Number(rule![1]), sel).toBeGreaterThanOrEqual(min);
    }
  });
});

describe('[P90] 001 and 002 Log in', () => {
  it('"Welcome back." and its sub-line; Forgot password? sits under the password field; "New here? Request access" at the bottom', () => {
    const { container } = render(<LoginScreen auth={auth()} onAuthed={vi.fn()} signupEnabled={false} />);
    expect(heading()).toHaveTextContent('Welcome back.');
    expect(screen.getByText("Let's see what your clients have been telling you.")).toBeInTheDocument();
    const order = [screen.getByLabelText('Email'), screen.getByLabelText('Password'), screen.getByRole('button', { name: 'Forgot password?' }), screen.getByRole('button', { name: 'Log in' }), screen.getByRole('link', { name: 'Request access' })];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, String(i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Request access' })).toHaveAttribute('href', '/request-access');
    expect(screen.getByRole('link', { name: 'Request access' }).closest('p')).toHaveTextContent('New here? Request access');
    expect(marks(container)).toHaveLength(0);
  });
  it('wrong password: an alert that does not say which was wrong; "reset your password" opens the forgot-password screen', async () => {
    const login = vi.fn(async () => { throw Object.assign(new Error('Invalid email or password.'), { code: 'invalid_credentials', status: 401 }); });
    render(<LoginScreen auth={auth({ login })} onAuthed={vi.fn()} signupEnabled={false} />);
    await userEvent.type(screen.getByLabelText('Email'), 'demo@tovira.local');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("That email and password don't match. Try again, or reset your password.");
    expect(alert.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(alert.textContent).not.toMatch(/wrong password|no account|not found|email is not|unknown email/i);
    await userEvent.click(within(alert).getByRole('button', { name: 'reset your password' }));
    expect(heading()).toHaveTextContent('Forgot it? No problem.');
  });
  it('NEGATIVE: another failure (too many attempts, offline) shows its own message, not the wrong-password line', async () => {
    const login = vi.fn(async () => { throw Object.assign(new Error('Too many attempts. Try again in a few minutes.'), { code: 'rate_limited', status: 429 }); });
    render(<LoginScreen auth={auth({ login })} onAuthed={vi.fn()} signupEnabled={false} />);
    await userEvent.type(screen.getByLabelText('Email'), 'demo@tovira.local');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in a few minutes.');
    expect(screen.getByRole('alert').textContent).not.toMatch(/don't match/);
  });
});

describe('[P90] 006 to 009 Password reset', () => {
  it('forgot: "Forgot it? No problem.", the same sub-line and button as before', () => {
    render(<ForgotPassword api={auth()} onBack={vi.fn()} />);
    expect(heading()).toHaveTextContent('Forgot it? No problem.');
    expect(screen.getByText("Enter your email and we'll send a link to set a new password.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
  it('sent: "Check your inbox.", the same message, "It expires in an hour." marked (the one mark)', async () => {
    const api = auth(); const { container } = render(<ForgotPassword api={api} onBack={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Email'), 'demo@tovira.local');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(heading()).toHaveTextContent('Check your inbox.'));
    expect(api.forgotPassword).toHaveBeenCalledWith('demo@tovira.local');
    expect(screen.getByRole('status')).toHaveTextContent('If that email has an account, a reset link is on its way. It expires in an hour.');
    expect(marks(container).map((m) => m.textContent)).toEqual(['It expires in an hour.']);
    expect(screen.getByRole('button', { name: 'Back to log in' })).toBeInTheDocument();
  });
  it('set new: "Choose a new password." and its sub-line', () => {
    render(<ResetPassword api={auth()} token="t" onDone={vi.fn()} />);
    expect(heading()).toHaveTextContent('Choose a new password.');
    expect(screen.getByText('This will be the password for your Tovira account.')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });
  it('an invalid or expired link (known on submit) replaces the form with its own screen; "Send a new link" opens forgot password', async () => {
    const onRequestNew = vi.fn();
    const resetPassword = vi.fn(async () => ({ ok: false, expired: true, message: 'This reset link is invalid or has expired. Request a new one.' }));
    render(<ResetPassword api={auth({ resetPassword })} token="old" onDone={vi.fn()} onRequestNew={onRequestNew} />);
    await userEvent.type(screen.getByLabelText('New password'), 'brandnew123');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(heading()).toHaveTextContent('That link has run out.'));
    expect(screen.getByText("Reset links last an hour and work once. Ask for a new one and you'll be back in shortly.")).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(onRequestNew).toHaveBeenCalledTimes(1);
  });
  it('NEGATIVE: another failure (a weak password) stays on the form with its message', async () => {
    const resetPassword = vi.fn(async () => ({ ok: false, message: 'Password must be at least 8 characters.' }));
    render(<ResetPassword api={auth({ resetPassword })} token="t" onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('New password'), 'brandnew123');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password must be at least 8 characters.');
    expect(heading()).toHaveTextContent('Choose a new password.');
  });
});

describe('[P90] 010 and 011 Email verification', () => {
  it('confirmed: the one heading and "Continue to Tovira"', async () => {
    const onDone = vi.fn();
    const { container } = render(<VerifyEmailPage api={{ verifyEmail: async () => ({ ok: true }), resendVerification: vi.fn() }} token="t" onDone={onDone} />);
    await waitFor(() => expect(heading()).toHaveTextContent('Your email is confirmed. Thank you.'));
    expect(container.querySelector('.auth__col')).not.toBeNull(); // the same full-page layout
    await userEvent.click(screen.getByRole('button', { name: 'Continue to Tovira' }));
    expect(onDone).toHaveBeenCalled();
  });
  it('a link that is not valid: "That link has run out." and where to get a new one', async () => {
    render(<VerifyEmailPage api={{ verifyEmail: async () => ({ ok: false, message: 'This verification link is invalid or has expired. Request a new one.' }), resendVerification: vi.fn() }} token="bad" onDone={vi.fn()} />);
    await waitFor(() => expect(heading()).toHaveTextContent('That link has run out.'));
    expect(screen.getByRole('alert')).toHaveTextContent("You can ask for a new one from Settings once you're signed in.");
    expect(screen.getByRole('button', { name: 'Continue to Tovira' })).toBeInTheDocument();
  });
});

describe('[P90] 012 to 014 Invite', () => {
  it('"You\'re in. Let\'s set you up." (the second sentence marked) and its sub-line; the Terms line unchanged, character for character', async () => {
    const { container } = render(<InviteAccept auth={auth()} token="t" onDone={vi.fn()} />);
    await waitFor(() => expect(heading()).toHaveTextContent("You're in. Let's set you up."));
    expect(marks(container).map((m) => m.textContent)).toEqual(["Let's set you up."]);
    expect(screen.getByText("Choose a password and you're ready to add your first client.")).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a password')).toBeInTheDocument();
    expect(screen.getByRole('checkbox').closest('label')!.textContent).toBe('I have read and accept the Terms of Service and Privacy Policy (version 2026-11-17 / 2026-11-18).');
    expect(screen.getByRole('button', { name: 'Set password and continue' })).toBeDisabled();
  });
  it('an expired invite: "This invite has expired.", the same text and button as before', async () => {
    const a = auth({ inviteStatus: vi.fn(async () => ({ valid: false, termsVersion: '', privacyVersion: '' })) });
    render(<InviteAccept auth={a} token="old" onDone={vi.fn()} />);
    await waitFor(() => expect(heading()).toHaveTextContent('This invite has expired.'));
    expect(screen.getByText('We can send a new one to the email address this invite was sent to.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(a.resendInvite).toHaveBeenCalledWith('old');
  });
});
