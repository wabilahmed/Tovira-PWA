import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FunnelPanel, stoppedAt } from './FunnelPanel.js';
import type { FunnelPerson, FunnelReport } from './adminClient.js';

// [P63-6 · owner] Admin → Funnel: 7 days / 30 days / all; the count at each step; one row per lead with each step's
// date and where they stopped.
const base: FunnelPerson = { key: '', name: null, email: null, company: null, source: 'invite', isTest: false, inviteSentAt: null, inviteOpenedAt: null, submittedAt: null, approvedAt: null, passwordSetAt: null, firstSignInAt: null, firstClientAt: null };
const T = Date.parse('2026-11-03T09:00:00Z');
const rows: FunnelPerson[] = [
  { ...base, key: 'lead:2', name: 'Omar Haddad', email: 'omar@aldar.example', company: 'Aldar', inviteSentAt: T, inviteOpenedAt: T },
  { ...base, key: 'request:9', name: 'Dana Rep', email: 'dana@example.ae', source: 'public', submittedAt: T, approvedAt: T },
];
const report = (period: FunnelReport['period']): FunnelReport => ({ period, since: null, rows, counts: { invitesSent: 1, linksOpened: 1, formsSubmitted: { invite: 0, public: 1, total: 1 }, approved: 1, passwordSet: 0, firstSignIn: 0, firstClient: 0 } });

describe('[P63-6] the Funnel tab', () => {
  it('shows the count at each step and one row per lead; 30 days by default, 7 days and all on tap', async () => {
    const funnel = vi.fn(async (p: FunnelReport['period']) => report(p));
    render(<FunnelPanel api={{ funnel }} onSignedOut={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('funnel-counts')).toBeInTheDocument());
    expect(funnel).toHaveBeenCalledWith('30d');
    expect(within(screen.getByTestId('funnel-step-Invites sent')).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('0 from an invite, 1 from the public form')).toBeInTheDocument();
    const omar = screen.getByTestId('funnel-row-lead:2');
    expect(within(omar).getByText('Stopped before: Form submitted')).toBeInTheDocument();
    expect(within(omar).getAllByText('3 Nov')).toHaveLength(2);
    // the public form has no invite steps
    expect(within(screen.getByTestId('funnel-row-request:9')).queryByText('Invite sent')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: '7 days' }));
    expect(funnel).toHaveBeenLastCalledWith('7d');
  });
  it('NEGATIVE: someone who has not started is not shown as done', () => {
    expect(stoppedAt({ ...base, source: 'invite', inviteSentAt: T })).toBe('Link opened');
    expect(stoppedAt({ ...base, source: 'public', submittedAt: T, approvedAt: T, passwordSetAt: T, firstSignInAt: T })).toBe('First client');
    expect(stoppedAt({ ...base, source: 'public', submittedAt: T, approvedAt: T, passwordSetAt: T, firstSignInAt: T, firstClientAt: T })).toBeNull();
  });
});
