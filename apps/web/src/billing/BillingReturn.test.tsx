import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BillingReturn } from './BillingReturn.js';
import type { Entitlement } from './billingClient.js';
import { KNOWN_SPA_PATHS, BILLING_RETURN_PATHS } from '../App.js';

const billingWith = (statuses: string[]): { status: () => Promise<Entitlement | null> } => {
  let i = 0;
  return { status: async () => ({ entitled: true, status: statuses[Math.min(i++, statuses.length - 1)]! } as Entitlement) };
};

afterEach(() => window.history.replaceState({}, '', '/'));

describe('[BILL-13] BillingReturn', () => {
  it('cancel: says no charge and routes back to Settings', async () => {
    const onNavigate = vi.fn();
    render(<BillingReturn mode="cancel" billing={billingWith(['trialing'])} onNavigate={onNavigate} />);
    expect(screen.getByText(/haven't been charged/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /back to settings/i }));
    expect(onNavigate).toHaveBeenCalledWith('/app?view=settings');
  });

  it('success: once billing is active, says "You\'re subscribed" with the plan and goes to Today', async () => {
    window.history.replaceState({}, '', '/billing/success?plan=annual');
    const onNavigate = vi.fn();
    render(<BillingReturn mode="success" billing={billingWith(['active'])} onNavigate={onNavigate} pollMs={1} />);
    expect(await screen.findByText(/you're subscribed to the yearly plan/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /go to today/i }));
    expect(onNavigate).toHaveBeenCalledWith('/app?view=today');
  });

  it('success: shows "Confirming…" then falls back to "Payment received" if it does not flip in time', async () => {
    render(<BillingReturn mode="success" billing={billingWith(['trialing'])} pollMs={1} maxTries={2} />);
    expect(screen.getByRole('status')).toHaveTextContent(/confirming your payment/i);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/payment received — your account will update in a moment/i));
  });

  it('top-up: shows "Top-up added" and never polls for a subscription', async () => {
    window.history.replaceState({}, '', '/billing/success?topup=1');
    const status = vi.fn();
    render(<BillingReturn mode="success" billing={{ status }} />);
    expect(screen.getByText(/top-up has been added/i)).toBeInTheDocument();
    expect(status).not.toHaveBeenCalled();
  });

  it('every configured return path is a known SPA route (never a 404)', () => {
    for (const p of BILLING_RETURN_PATHS) expect(KNOWN_SPA_PATHS.has(p)).toBe(true);
  });
});
