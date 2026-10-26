import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessPanel } from './AccessPanel.js';
import { AdminSignedOutError, type AccessRequest, type AdminApi } from './adminClient.js';

/**
 * [P33 → P45-4] The beta access requests, moved from /ops/access into the admin console. Same behaviour; the admin
 * session replaces the ops token. [P45 · owner] The token-prompt tests became admin-session tests (no token is ever
 * asked for; a signed-out session goes back to sign-in).
 */
const req = (o: Partial<AccessRequest> = {}): AccessRequest => ({
  id: 'r1', fullName: 'Sara Khan', workEmail: 'sara@khanrealty.ae', phone: '+971501234567', companyName: 'Khan Realty', roleTitle: 'Broker',
  ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-123', conversationOwnership: 'own_clients', conversationOwnershipOther: null,
  expectedVolume: '50_200', industry: null, industryOther: null, source: 'form', createdAt: Date.parse('2026-10-19T08:00:00Z'), status: 'pending', reviewedAt: null, reviewedNote: null, linkedUserId: null, ...o,
});
type AccessApi = Pick<AdminApi, 'accessList' | 'approve' | 'reject' | 'reinvite'>;
function api(requests: AccessRequest[], over: Partial<AccessApi> = {}): AccessApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    accessList: vi.fn(async (status?: string) => { calls.push(`list:${status ?? 'all'}`); return requests.filter((r) => !status || r.status === status); }),
    approve: vi.fn(async (id: string) => { calls.push(`approve:${id}`); return { ...requests.find((r) => r.id === id)!, status: 'invited' as const }; }),
    reject: vi.fn(async (id: string, note: string) => { calls.push(`reject:${id}:${note}`); return { ...requests.find((r) => r.id === id)!, status: 'rejected' as const }; }),
    reinvite: vi.fn(async (id: string) => { calls.push(`reinvite:${id}`); return requests.find((r) => r.id === id)!; }),
    ...over,
  };
}

describe('[P33 → P45-4] Access in the admin console', () => {
  it('[P45 · owner] never asks for the ops token: it lists pending requests with the applicant details', async () => {
    const a = api([req(), req({ id: 'r2', fullName: 'Omar Ali', status: 'invited' })]);
    render(<AccessPanel api={a} onSignedOut={vi.fn()} />);
    const card = await screen.findByTestId('request-r1');
    expect(screen.queryByLabelText(/ops token/i)).toBeNull();
    for (const t of ['Sara Khan', 'sara@khanrealty.ae', 'Khan Realty', 'Broker']) expect(card).toHaveTextContent(t);
    expect(screen.queryByTestId('request-r2')).toBeNull(); // pending filter by default
    expect(a.calls[0]).toBe('list:pending');
  });

  it('Approve (after a confirm) approves and says the invite was emailed', async () => {
    const a = api([req()]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccessPanel api={a} onSignedOut={vi.fn()} />);
    await userEvent.click(within(await screen.findByTestId('request-r1')).getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(a.calls).toContain('approve:r1'));
    expect(await screen.findByText(/approved\. invite emailed to sara@khanrealty\.ae/i)).toBeInTheDocument();
  });

  it('NEGATIVE: cancelling the confirm approves nothing', async () => {
    const a = api([req()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AccessPanel api={a} onSignedOut={vi.fn()} />);
    await userEvent.click(within(await screen.findByTestId('request-r1')).getByRole('button', { name: /approve/i }));
    expect(a.calls.some((c) => c.startsWith('approve'))).toBe(false);
  });

  it('Reject records the note (no email)', async () => {
    const a = api([req()]);
    vi.spyOn(window, 'prompt').mockReturnValue('Not a relationship-sales role');
    render(<AccessPanel api={a} onSignedOut={vi.fn()} />);
    await userEvent.click(within(await screen.findByTestId('request-r1')).getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(a.calls).toContain('reject:r1:Not a relationship-sales role'));
  });

  // [P45 · owner] same reminder; the new copy has no em-dash
  it('an employed applicant is flagged: ask for the company NOC before approving', async () => {
    render(<AccessPanel api={api([req({ ownership: 'employed', tradeLicenceNumber: null })])} onSignedOut={vi.fn()} />);
    expect(await screen.findByTestId('request-r1')).toHaveTextContent('Employed: ask for the company NOC before approving.');
  });

  it('"All" shows every status, and an invited request offers Re-invite', async () => {
    const a = api([req(), req({ id: 'r2', fullName: 'Omar Ali', status: 'invited', linkedUserId: 'u2' })]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccessPanel api={a} onSignedOut={vi.fn()} />);
    await screen.findByTestId('request-r1');
    await userEvent.click(screen.getByRole('button', { name: /^all$/i }));
    await userEvent.click(within(await screen.findByTestId('request-r2')).getByRole('button', { name: /re-invite/i }));
    await waitFor(() => expect(a.calls).toContain('reinvite:r2'));
  });

  it('[P45 · owner] NEGATIVE: a signed-out admin session goes back to sign-in', async () => {
    const onSignedOut = vi.fn();
    render(<AccessPanel api={api([], { accessList: vi.fn(async () => { throw new AdminSignedOutError(); }) })} onSignedOut={onSignedOut} />);
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });

  it('says so when nothing is waiting', async () => {
    render(<AccessPanel api={api([])} onSignedOut={vi.fn()} />);
    expect(await screen.findByText(/no pending requests/i)).toBeInTheDocument();
  });

  it('[P42-A6] labels each request\'s industry; Other shows its text; a pre-P42 request says "Not given"', async () => {
    render(<AccessPanel api={api([req({ id: 'r1', industry: 'insurance' }), req({ id: 'r2', fullName: 'Omar Ali', industry: 'other', industryOther: 'Yacht brokerage' }), req({ id: 'r3', fullName: 'Old Request', industry: null })])} onSignedOut={vi.fn()} />);
    expect(within(await screen.findByTestId('request-r1')).getByTestId('industry')).toHaveTextContent('Industry: Insurance');
    expect(within(screen.getByTestId('request-r2')).getByTestId('industry')).toHaveTextContent('Industry: Other (Yacht brokerage)');
    expect(within(screen.getByTestId('request-r3')).getByTestId('industry')).toHaveTextContent('Industry: Not given');
  });

  it('[P45-3] a request made from a hot lead is marked, and shows "Not asked" for the form\'s questions', async () => {
    render(<AccessPanel api={api([req({ source: 'hot_lead', phone: null, ownership: null, tradeLicenceNumber: null, conversationOwnership: null, expectedVolume: null })])} onSignedOut={vi.fn()} />);
    const card = await screen.findByTestId('request-r1');
    expect(card).toHaveTextContent('From a hot lead');
    expect(card).toHaveTextContent('Ownership: Not asked');
    expect(card).toHaveTextContent('conversations: Not asked');
    expect(card).toHaveTextContent('volume: Not asked');
  });
});
