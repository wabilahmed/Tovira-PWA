import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminApp, opsRedirect } from './AdminApp.js';
import type { AdminApi, AdminStage } from './adminClient.js';

/**
 * [P45-4 · owner] The admin console at /admin: its own sign-in (password, then 2FA), enrolment on first sign-in with
 * 10 recovery codes shown once, then a small nav: Leads · Access · Costs · Audit. /ops/access and /ops/costs redirect.
 */
afterEach(() => { window.history.replaceState({}, '', '/'); });
function api(stage: AdminStage | null, over: Partial<AdminApi> = {}): AdminApi {
  let s = stage;
  return {
    me: vi.fn(async () => (s ? { email: 'wabil@tovira.io', stage: s } : null)),
    login: vi.fn(async () => { s = 'mfa_required'; return s; }),
    setPassword: vi.fn(async () => { s = 'enrol_required'; }),
    enrolStart: vi.fn(async () => ({ secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' })),
    enrolConfirm: vi.fn(async () => { s = 'ok'; return Array.from({ length: 10 }, (_, i) => `code-${i}-abcd`); }),
    verifyMfa: vi.fn(async () => { s = 'ok'; }),
    logout: vi.fn(async () => { s = null; }),
    audit: vi.fn(async () => [{ adminEmail: 'wabil@tovira.io', action: 'access.approve', target: 'dana@x.ae', detail: null, at: Date.parse('2026-10-26T10:00:00Z') }]),
    accessList: vi.fn(async () => []), approve: vi.fn(), reject: vi.fn(), reinvite: vi.fn(),
    costs: vi.fn(async () => ({ view: 'period' as const, ceilingAed: 67, voiceRecordedSince: null, rows: [], totals: [] })),
    leads: vi.fn(async () => ({ leads: [], newCount: 0, countries: [], sync: { cursor: null, lastRunAt: null, lastStatus: null, banner: null } })),
    updateLead: vi.fn(), previewInvite: vi.fn(), sendInvite: vi.fn(), addTestLead: vi.fn(), downloadCsv: vi.fn(), // [P58 · owner] Invite to beta became the invite email
    ...over,
  };
}

describe('[P45-4] /admin sign-in', () => {
  it('signed out: a login form (email + password), never an ops-token field', async () => {
    window.history.replaceState({}, '', '/admin');
    render(<AdminApp api={api(null)} />);
    expect(await screen.findByRole('heading', { name: 'Admin sign-in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.queryByLabelText(/ops token/i)).toBeNull();
  });

  it('password, then the 6-digit code, then the console', async () => {
    window.history.replaceState({}, '', '/admin');
    const a = api(null);
    render(<AdminApp api={a} />);
    await userEvent.type(await screen.findByLabelText('Email'), 'wabil@tovira.io');
    await userEvent.type(screen.getByLabelText('Password'), 'a long admin passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.type(await screen.findByLabelText('6-digit code or a recovery code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(a.verifyMfa).toHaveBeenCalledWith('123456');
    expect(await screen.findByRole('navigation', { name: 'Admin' })).toBeInTheDocument();
  });

  it('first sign-in: set the password from the link, add the authenticator, then 10 recovery codes shown once', async () => {
    window.history.replaceState({}, '', '/admin/set-password?token=abc123');
    const a = api(null);
    render(<AdminApp api={a} />);
    await userEvent.type(await screen.findByLabelText('New password'), 'a long admin passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(a.setPassword).toHaveBeenCalledWith('abc123', 'a long admin passphrase');
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in your authenticator app' })).toHaveAttribute('href', 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP');
    await userEvent.type(screen.getByLabelText('6-digit code from the app'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on two-factor' }));
    const codes = await screen.findByTestId('recovery-codes');
    expect(within(codes).getAllByRole('listitem')).toHaveLength(10);
    await userEvent.click(screen.getByRole('button', { name: 'I have saved these codes' }));
    expect(await screen.findByRole('navigation', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-codes')).toBeNull(); // shown once
  });
});

describe('[P45-4] the console', () => {
  it('a small nav: Leads · Access · Costs · Audit; Sign out ends the session', async () => {
    window.history.replaceState({}, '', '/admin/leads');
    const a = api('ok');
    render(<AdminApp api={a} />);
    const nav = await screen.findByRole('navigation', { name: 'Admin' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Leads', 'Access', 'Costs', 'Audit']);
    await userEvent.click(within(nav).getByRole('link', { name: 'Access' }));
    expect(window.location.pathname).toBe('/admin/access');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(a.logout).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Admin sign-in' })).toBeInTheDocument();
  });

  it('the Audit tab lists who did what, when', async () => {
    window.history.replaceState({}, '', '/admin/audit');
    render(<AdminApp api={api('ok')} />);
    const row = await screen.findByTestId('audit-0');
    for (const t of ['wabil@tovira.io', 'Approved access', 'dana@x.ae']) expect(row).toHaveTextContent(t);
  });

  it('/admin opens Leads', async () => {
    window.history.replaceState({}, '', '/admin');
    const a = api('ok');
    render(<AdminApp api={a} />);
    await waitFor(() => expect(window.location.pathname).toBe('/admin/leads'));
  });
});

describe('[P45-4] /ops pages redirect', () => {
  it('/ops/access → /admin/access, /ops/costs → /admin/costs, anything else → null', () => {
    expect(opsRedirect('/ops/access')).toBe('/admin/access');
    expect(opsRedirect('/ops/costs')).toBe('/admin/costs');
    expect(opsRedirect('/app')).toBeNull();
  });
});

// [P59-3 · owner, parked from P58] The invite email's audit entries read as sentences, not action codes.
describe('[P59-3] readable audit labels for the invite email', () => {
  it('send, resend, test lead, the form from the invite, and the automatic approval', async () => {
    window.history.replaceState({}, '', '/admin/audit');
    const at = Date.parse('2026-10-29T10:00:00Z');
    const entries = [
      { adminEmail: 'wabil@tovira.io', action: 'lead.invite_email', target: 'sara@emaar.example', detail: null, at },
      { adminEmail: 'wabil@tovira.io', action: 'lead.invite_email_resend', target: 'sara@emaar.example', detail: null, at },
      { adminEmail: 'wabil@tovira.io', action: 'lead.test_created', target: 'wabil@prospera-technologies.com', detail: null, at },
      { adminEmail: 'invite link', action: 'lead.requested', target: 'sara@emaar.example', detail: null, at },
      { adminEmail: 'invite link', action: 'access.auto_approve', target: 'sara@emaar.example', detail: null, at },
    ];
    render(<AdminApp api={api('ok', { audit: vi.fn(async () => entries) })} />);
    const labels = ['Sent the beta invite email', 'Re-sent the beta invite email', 'Added a test lead', 'Sent the request form from the invite', 'Approved access automatically (invite link)'];
    for (const [i, label] of labels.entries()) {
      const row = await screen.findByTestId(`audit-${i}`);
      expect(row).toHaveTextContent(label);
      expect(row).not.toHaveTextContent(entries[i]!.action);
    }
  });
});
