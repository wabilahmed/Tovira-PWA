import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteAccept } from './InviteAccept.js';
import type { AuthClient } from './authClient.js';

const client = (over: Partial<AuthClient> = {}): AuthClient => ({
  inviteStatus: vi.fn().mockResolvedValue({ valid: true, termsVersion: '2026-09-22', privacyVersion: '2026-09-22' }),
  acceptInvite: vi.fn().mockResolvedValue({ ok: true }),
  resendInvite: vi.fn().mockResolvedValue({ ok: true }),
  ...over,
} as unknown as AuthClient);

describe('<InviteAccept>', () => {
  it('[BETA-8] an expired/invalid link offers to send a NEW one to the original address, and confirms neutrally', async () => {
    const auth = client({ inviteStatus: vi.fn().mockResolvedValue({ valid: false, termsVersion: '', privacyVersion: '' }) });
    const user = userEvent.setup();
    render(<InviteAccept auth={auth} token="expired-token" onDone={() => {}} />);
    expect(await screen.findByText(/this link has expired/i)).toBeTruthy();
    // The copy makes clear the new link goes to the email the invite was sent to — never one typed here.
    expect(screen.getByText(/email address this invite was sent to/i)).toBeTruthy();
    // There is NO address field to supply a different recipient.
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.click(screen.getByRole('button', { name: /send a new link/i }));
    await waitFor(() => expect(auth.resendInvite).toHaveBeenCalledWith('expired-token'));
    expect(await screen.findByText(/check your inbox and spam folder/i)).toBeTruthy();
  });

  it('[BETA-8] when the resend budget is spent, it shows the rate-limit message', async () => {
    const auth = client({
      inviteStatus: vi.fn().mockResolvedValue({ valid: false, termsVersion: '', privacyVersion: '' }),
      resendInvite: vi.fn().mockResolvedValue({ ok: false, rateLimited: true, message: "We've already sent a few links today. Check your inbox and spam folder, or contact hello@tovira.io." }),
    });
    const user = userEvent.setup();
    render(<InviteAccept auth={auth} token="expired-token" onDone={() => {}} />);
    await screen.findByText(/this link has expired/i);
    await user.click(screen.getByRole('button', { name: /send a new link/i }));
    expect(await screen.findByText(/already sent a few links today/i)).toBeTruthy();
    expect(screen.getByText(/hello@tovira\.io/i)).toBeTruthy();
  });

  it('shows the form with the accepted version, keeps submit disabled until terms are ticked, and completes', async () => {
    const auth = client();
    const user = userEvent.setup();
    render(<InviteAccept auth={auth} token="good" onDone={() => {}} />);
    await screen.findByText(/Set up your Tovira account/i);
    expect(screen.getByText(/version 2026-09-22/i)).toBeTruthy();
    expect(screen.getByText(/Terms of Service/i).closest('a')!.getAttribute('href')).toBe('/terms');

    await user.type(screen.getByLabelText(/Choose a password/i), 'password123');
    const submit = screen.getByRole('button', { name: /set password/i });
    expect(submit).toBeDisabled(); // terms not yet accepted
    await user.click(screen.getByRole('checkbox'));
    expect(submit).not.toBeDisabled();
    await user.click(submit);

    await waitFor(() => expect(auth.acceptInvite).toHaveBeenCalledWith('good', 'password123', true));
    expect(await screen.findByText(/account is ready/i)).toBeTruthy();
  });

  it('surfaces a server error without leaving the form', async () => {
    const auth = client({ acceptInvite: vi.fn().mockResolvedValue({ ok: false, message: 'This invitation link is invalid, has expired, or has already been used.' }) });
    const user = userEvent.setup();
    render(<InviteAccept auth={auth} token="good" onDone={() => {}} />);
    await screen.findByText(/Set up your Tovira account/i);
    await user.type(screen.getByLabelText(/Choose a password/i), 'password123');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /set password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid, has expired, or has already been used/i);
  });
});
