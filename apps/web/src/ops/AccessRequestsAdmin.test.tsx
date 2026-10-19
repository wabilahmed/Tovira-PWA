import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessRequestsAdmin } from './AccessRequestsAdmin.js';
import { OpsUnauthorizedError, type OpsAccessApi, type OpsAccessRequest } from './opsAccessClient.js';

/**
 * [P33] The owner reviews beta access requests on a page (no curl): /ops/access. The page holds no secret of
 * its own — every call carries the ops token the owner types in (kept for this tab only, sessionStorage), and
 * the API refuses everything without it. Approve creates the account + emails the invite; Reject records a
 * note (no email); Re-invite re-sends a lost link.
 */
const req = (o: Partial<OpsAccessRequest> = {}): OpsAccessRequest => ({
  id: 'r1', fullName: 'Sara Khan', workEmail: 'sara@khanrealty.ae', phone: '+971501234567', companyName: 'Khan Realty', roleTitle: 'Broker',
  ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-123', conversationOwnership: 'own_clients', conversationOwnershipOther: null,
  expectedVolume: '50_200', createdAt: Date.parse('2026-10-19T08:00:00Z'), status: 'pending', reviewedAt: null, reviewedNote: null, linkedUserId: null, ...o,
});
function api(requests: OpsAccessRequest[], over: Partial<OpsAccessApi> = {}): OpsAccessApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    list: vi.fn(async (token: string, status?: string) => { calls.push(`list:${token}:${status ?? 'all'}`); return requests.filter((r) => !status || r.status === status); }),
    approve: vi.fn(async (_t: string, id: string) => { calls.push(`approve:${id}`); return { ...requests.find((r) => r.id === id)!, status: 'invited' as const }; }),
    reject: vi.fn(async (_t: string, id: string, note: string) => { calls.push(`reject:${id}:${note}`); return { ...requests.find((r) => r.id === id)!, status: 'rejected' as const }; }),
    reinvite: vi.fn(async (_t: string, id: string) => { calls.push(`reinvite:${id}`); return requests.find((r) => r.id === id)!; }),
    ...over,
  };
}

beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });

describe('[P33] /ops/access — beta access requests', () => {
  it('asks for the ops token first; nothing is fetched without it', () => {
    const a = api([req()]);
    render(<AccessRequestsAdmin api={a} />);
    expect(screen.getByLabelText(/ops token/i)).toHaveAttribute('type', 'password');
    expect(a.calls).toEqual([]);
  });

  it('with the token, lists pending requests with the applicant details', async () => {
    const a = api([req(), req({ id: 'r2', fullName: 'Omar Ali', status: 'invited' })]);
    render(<AccessRequestsAdmin api={a} />);
    await userEvent.type(screen.getByLabelText(/ops token/i), 'tok123');
    await userEvent.click(screen.getByRole('button', { name: /open/i }));
    const card = await screen.findByTestId('request-r1');
    expect(card).toHaveTextContent('Sara Khan');
    expect(card).toHaveTextContent('sara@khanrealty.ae');
    expect(card).toHaveTextContent('Khan Realty');
    expect(card).toHaveTextContent('Broker');
    expect(screen.queryByTestId('request-r2')).toBeNull(); // pending filter by default
    expect(a.calls[0]).toBe('list:tok123:pending');
    expect(sessionStorage.getItem('tovira.opsToken')).toBe('tok123'); // this tab only
  });

  it('Approve (after a confirm) approves and shows the request as invited', async () => {
    sessionStorage.setItem('tovira.opsToken', 'tok123');
    const a = api([req()]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccessRequestsAdmin api={a} />);
    const card = await screen.findByTestId('request-r1');
    await userEvent.click(within(card).getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(a.calls).toContain('approve:r1'));
    expect(await screen.findByText(/approved — invite emailed to sara@khanrealty\.ae/i)).toBeInTheDocument();
  });

  it('NEGATIVE: cancelling the confirm approves nothing', async () => {
    sessionStorage.setItem('tovira.opsToken', 'tok123');
    const a = api([req()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AccessRequestsAdmin api={a} />);
    await userEvent.click(within(await screen.findByTestId('request-r1')).getByRole('button', { name: /approve/i }));
    expect(a.calls.some((c) => c.startsWith('approve'))).toBe(false);
  });

  it('Reject records the note (no email)', async () => {
    sessionStorage.setItem('tovira.opsToken', 'tok123');
    const a = api([req()]);
    vi.spyOn(window, 'prompt').mockReturnValue('Not a field-sales role');
    render(<AccessRequestsAdmin api={a} />);
    await userEvent.click(within(await screen.findByTestId('request-r1')).getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(a.calls).toContain('reject:r1:Not a field-sales role'));
  });

  it('an employed applicant is flagged: ask for the company NOC before approving', async () => {
    sessionStorage.setItem('tovira.opsToken', 'tok123');
    render(<AccessRequestsAdmin api={api([req({ ownership: 'employed' })])} />);
    expect(await screen.findByTestId('request-r1')).toHaveTextContent(/employed — ask for the company NOC before approving/i);
  });

  it('"All" shows every status, and an invited request offers Re-invite', async () => {
    sessionStorage.setItem('tovira.opsToken', 'tok123');
    const a = api([req(), req({ id: 'r2', fullName: 'Omar Ali', status: 'invited', linkedUserId: 'u2' })]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccessRequestsAdmin api={a} />);
    await screen.findByTestId('request-r1');
    await userEvent.click(screen.getByRole('button', { name: /^all$/i }));
    const invited = await screen.findByTestId('request-r2');
    await userEvent.click(within(invited).getByRole('button', { name: /re-invite/i }));
    await waitFor(() => expect(a.calls).toContain('reinvite:r2'));
  });

  it('NEGATIVE: a wrong token is refused, forgotten, and the token form comes back', async () => {
    sessionStorage.setItem('tovira.opsToken', 'wrong');
    render(<AccessRequestsAdmin api={api([], { list: vi.fn(async () => { throw new OpsUnauthorizedError(); }) })} />);
    expect(await screen.findByText(/that ops token was refused/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ops token/i)).toBeInTheDocument();
    expect(sessionStorage.getItem('tovira.opsToken')).toBeNull();
  });

  it('says so when nothing is waiting', async () => {
    sessionStorage.setItem('tovira.opsToken', 'tok123');
    render(<AccessRequestsAdmin api={api([])} />);
    expect(await screen.findByText(/no pending requests/i)).toBeInTheDocument();
  });
});
