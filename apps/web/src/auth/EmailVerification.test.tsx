import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VerifyEmailPage, VerifyBanner } from './EmailVerification.js';

describe('[EMAIL-VERIFY] VerifyEmailPage', () => {
  it('confirms on mount and offers a way back into the app', async () => {
    const api = { verifyEmail: vi.fn().mockResolvedValue({ ok: true }), resendVerification: vi.fn() };
    const onDone = vi.fn();
    render(<VerifyEmailPage api={api} token="tok" onDone={onDone} />);
    expect(await screen.findByText(/your email is confirmed/i)).toBeInTheDocument();
    expect(api.verifyEmail).toHaveBeenCalledWith('tok');
    await userEvent.click(screen.getByRole('button', { name: /continue to tovira/i }));
    expect(onDone).toHaveBeenCalled();
  });

  it('shows the failure message on a bad/expired token (no crash, still lets you continue)', async () => {
    const api = { verifyEmail: vi.fn().mockResolvedValue({ ok: false, message: 'This verification link is invalid or has expired.' }), resendVerification: vi.fn() };
    render(<VerifyEmailPage api={api} token="bad" onDone={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
    expect(screen.getByRole('button', { name: /continue to tovira/i })).toBeInTheDocument();
  });
});

describe('[EMAIL-VERIFY] VerifyBanner', () => {
  it('shows the confirm nudge and resends on demand', async () => {
    const api = { verifyEmail: vi.fn(), resendVerification: vi.fn().mockResolvedValue({ ok: true }) };
    render(<VerifyBanner api={api} />);
    expect(screen.getByText(/confirm your email so we can reach you/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /resend/i }));
    expect(api.resendVerification).toHaveBeenCalled();
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  });

  it('surfaces the server rate limit calmly', async () => {
    const api = { verifyEmail: vi.fn(), resendVerification: vi.fn().mockResolvedValue({ ok: false, rateLimited: true }) };
    render(<VerifyBanner api={api} />);
    await userEvent.click(screen.getByRole('button', { name: /resend/i }));
    expect(await screen.findByText(/too many today/i)).toBeInTheDocument();
  });

  it('can be dismissed', async () => {
    const api = { verifyEmail: vi.fn(), resendVerification: vi.fn() };
    const onDismiss = vi.fn();
    render(<VerifyBanner api={api} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
