import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginScreen } from './LoginScreen.js';
import type { AuthClient } from './authClient.js';

// [REFERRAL-ENTRY] The signup form has an optional, editable referral-code field (prefilled from
// ?ref=), and after signup shows a clear applied/invalid outcome — an invalid code never blocks.

function fakeAuth(over: Partial<AuthClient> = {}): AuthClient {
  return {
    login: vi.fn().mockResolvedValue({ user: { id: 'u', email: 'a@b.com', referralCode: 'code', emailVerified: true, timezone: 'UTC' } }),
    signup: vi.fn().mockResolvedValue({ user: { id: 'u', email: 'a@b.com', referralCode: 'code', emailVerified: false, timezone: 'UTC' }, referral: 'none' }),
    ...over,
  } as unknown as AuthClient;
}

afterEach(() => {
  window.history.replaceState({}, '', '/'); // clear any ?ref= between tests
});

async function gotoSignup(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /need an account/i }));
}

describe('<LoginScreen> referral entry', () => {
  it('shows an editable referral-code field on signup (not on login)', async () => {
    const user = userEvent.setup();
    render(<LoginScreen auth={fakeAuth()} onAuthed={vi.fn()} />);
    expect(screen.queryByLabelText(/referral code/i)).toBeNull(); // login mode: no field
    await gotoSignup(user);
    expect(screen.getByLabelText(/referral code/i)).toBeInTheDocument();
  });

  it('prefills the field from ?ref= but keeps it editable', async () => {
    window.history.replaceState({}, '', '/?ref=ALICE123');
    const user = userEvent.setup();
    render(<LoginScreen auth={fakeAuth()} onAuthed={vi.fn()} />);
    await gotoSignup(user);
    const field = screen.getByLabelText(/referral code/i) as HTMLInputElement;
    expect(field.value).toBe('ALICE123');
    await user.clear(field);
    await user.type(field, 'BOB456');
    expect(field.value).toBe('BOB456');
  });

  it('passes the typed code to signup and shows the APPLIED message, then Continue proceeds', async () => {
    const signup = vi.fn().mockResolvedValue({ user: { id: 'u', email: 'r@b.com', referralCode: 'x', emailVerified: false, timezone: 'UTC' }, referral: 'applied' });
    const onAuthed = vi.fn();
    const user = userEvent.setup();
    render(<LoginScreen auth={fakeAuth({ signup })} onAuthed={onAuthed} />);
    await gotoSignup(user);
    await user.type(screen.getByLabelText(/^email/i), 'r@b.com');
    await user.type(screen.getByLabelText(/^password/i), 'password123');
    await user.type(screen.getByLabelText(/referral code/i), 'ALICE123');
    await user.click(screen.getByLabelText(/accept terms/i));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(signup).toHaveBeenCalledWith('r@b.com', 'password123', 'ALICE123', true);
    expect(await screen.findByText(/referral applied/i)).toBeInTheDocument();
    expect(onAuthed).not.toHaveBeenCalled(); // waits for Continue
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(onAuthed).toHaveBeenCalled();
  });

  it('an INVALID code does not block signup — shows the "couldn\'t find" message, account still created', async () => {
    const signup = vi.fn().mockResolvedValue({ user: { id: 'u', email: 'r@b.com', referralCode: 'x', emailVerified: false, timezone: 'UTC' }, referral: 'invalid' });
    const onAuthed = vi.fn();
    const user = userEvent.setup();
    render(<LoginScreen auth={fakeAuth({ signup })} onAuthed={onAuthed} />);
    await gotoSignup(user);
    await user.type(screen.getByLabelText(/^email/i), 'r@b.com');
    await user.type(screen.getByLabelText(/^password/i), 'password123');
    await user.type(screen.getByLabelText(/referral code/i), 'no-such-code');
    await user.click(screen.getByLabelText(/accept terms/i));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/couldn't find that referral code/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(onAuthed).toHaveBeenCalled(); // the account was created; Continue enters the app
  });

  it('signup with NO code goes straight in (no referral interstitial)', async () => {
    const onAuthed = vi.fn();
    const user = userEvent.setup();
    render(<LoginScreen auth={fakeAuth()} onAuthed={onAuthed} />); // signup mock returns referral:'none'
    await gotoSignup(user);
    await user.type(screen.getByLabelText(/^email/i), 'r@b.com');
    await user.type(screen.getByLabelText(/^password/i), 'password123');
    await user.click(screen.getByLabelText(/accept terms/i));
    await user.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(onAuthed).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();
  });
});
