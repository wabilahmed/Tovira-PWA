import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FreeAccessPanel } from './FreeAccessPanel.js';
import { AdminSignedOutError, type AdminApi, type FreeAccessAccount } from './adminClient.js';

/**
 * [P72-2 · owner] Admin → Access → Free access: type the email of an existing account and press Give free access;
 * the list shows who has it, since when and who gave it, each with Revoke (after a confirm). Until revoked.
 */
type Api = Pick<AdminApi, 'freeAccessList' | 'grantFreeAccess' | 'revokeFreeAccess'>;
const acct = (email: string): FreeAccessAccount => ({ email, since: Date.parse('2026-11-17T09:00:00Z'), by: 'wabil@tovira.io' });
function makeApi(initial: FreeAccessAccount[], over: Partial<Api> = {}): Api {
  let list = [...initial];
  return {
    freeAccessList: vi.fn(async () => list),
    grantFreeAccess: vi.fn(async (email: string) => { const a = acct(email.trim().toLowerCase()); list = [...list, a]; return a; }),
    revokeFreeAccess: vi.fn(async (email: string) => { list = list.filter((a) => a.email !== email); }),
    ...over,
  };
}
afterEach(() => vi.restoreAllMocks());

describe('[P72-2] Free access in Admin', () => {
  it('lists who has it, since when and who gave it', async () => {
    render(<FreeAccessPanel api={makeApi([acct('dana@example.ae')])} onSignedOut={() => {}} />);
    const row = await screen.findByTestId('free-access-row');
    expect(row).toHaveTextContent('dana@example.ae');
    expect(row).toHaveTextContent('17 Nov 2026');
    expect(row).toHaveTextContent('wabil@tovira.io');
  });
  it('Give free access by email adds it to the list and says so', async () => {
    const a = makeApi([]);
    render(<FreeAccessPanel api={a} onSignedOut={() => {}} />);
    await screen.findByText('Nobody has free access.');
    await userEvent.type(screen.getByLabelText('Account email'), 'wabil@tovira.io');
    await userEvent.click(screen.getByRole('button', { name: 'Give free access' }));
    expect(a.grantFreeAccess).toHaveBeenCalledWith('wabil@tovira.io');
    expect(await screen.findByRole('status')).toHaveTextContent('wabil@tovira.io now has free access until you revoke it.');
    expect(await screen.findByTestId('free-access-row')).toHaveTextContent('wabil@tovira.io');
  });
  it('Revoke asks first, then removes it', async () => {
    const a = makeApi([acct('dana@example.ae')]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<FreeAccessPanel api={a} onSignedOut={() => {}} />);
    const row = await screen.findByTestId('free-access-row');
    await userEvent.click(within(row).getByRole('button', { name: 'Revoke' }));
    expect(confirm).toHaveBeenCalledWith('Revoke free access for dana@example.ae? Their account goes back to what it was before (for example, an ended trial).');
    expect(a.revokeFreeAccess).toHaveBeenCalledWith('dana@example.ae');
    await waitFor(() => expect(screen.queryByTestId('free-access-row')).toBeNull());
  });
  it('NEGATIVE: Revoke cancelled does nothing', async () => {
    const a = makeApi([acct('dana@example.ae')]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<FreeAccessPanel api={a} onSignedOut={() => {}} />);
    await userEvent.click(within(await screen.findByTestId('free-access-row')).getByRole('button', { name: 'Revoke' }));
    expect(a.revokeFreeAccess).not.toHaveBeenCalled();
  });
  it('NEGATIVE: an unknown email shows the server\'s message and adds nothing', async () => {
    const a = makeApi([], { grantFreeAccess: vi.fn(async () => { throw new Error('No account uses that email.'); }) });
    render(<FreeAccessPanel api={a} onSignedOut={() => {}} />);
    await screen.findByText('Nobody has free access.');
    await userEvent.type(screen.getByLabelText('Account email'), 'nobody@example.ae');
    await userEvent.click(screen.getByRole('button', { name: 'Give free access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No account uses that email.');
    expect(screen.queryByTestId('free-access-row')).toBeNull();
  });
  it('NEGATIVE: a signed-out session goes back to sign-in', async () => {
    const onSignedOut = vi.fn();
    render(<FreeAccessPanel api={makeApi([], { freeAccessList: vi.fn(async () => { throw new AdminSignedOutError(); }) })} onSignedOut={onSignedOut} />);
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });
});
