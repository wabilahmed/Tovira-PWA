import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPassword, ResetPassword, type ResetApi } from './PasswordReset.js';

const makeApi = (over: Partial<ResetApi> = {}): ResetApi => ({
  forgotPassword: vi.fn().mockResolvedValue(undefined),
  resetPassword: vi.fn().mockResolvedValue({ ok: true }),
  ...over,
});

describe('<ForgotPassword>', () => {
  it('shows non-revealing confirmation copy after requesting (no enumeration)', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<ForgotPassword api={api} onBack={vi.fn()} />);
    await user.type(screen.getByLabelText(/email/i), 'rep@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/if that email has an account/i);
    expect(api.forgotPassword).toHaveBeenCalledWith('rep@example.com');
  });
});

describe('<ResetPassword>', () => {
  it('sets a new password from the token and confirms', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<ResetPassword api={api} token="tok123" onDone={vi.fn()} />);
    await user.type(screen.getByLabelText(/new password/i), 'brandnew123');
    await user.click(screen.getByRole('button', { name: /set new password/i }));
    await waitFor(() => expect(api.resetPassword).toHaveBeenCalledWith('tok123', 'brandnew123'));
    expect(await screen.findByRole('status')).toHaveTextContent(/updated/i);
  });

  it('shows the server error on an invalid/expired token', async () => {
    const user = userEvent.setup();
    const api = makeApi({ resetPassword: vi.fn().mockResolvedValue({ ok: false, message: 'This reset link is invalid or has expired. Request a new one.' }) });
    render(<ResetPassword api={api} token="bad" onDone={vi.fn()} />);
    await user.type(screen.getByLabelText(/new password/i), 'brandnew123');
    await user.click(screen.getByRole('button', { name: /set new password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
  });
});
