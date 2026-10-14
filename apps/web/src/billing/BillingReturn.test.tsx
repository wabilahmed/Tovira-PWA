import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BillingReturn } from './BillingReturn.js';
import type { Entitlement } from './billingClient.js';
import { KNOWN_SPA_PATHS, BILLING_RETURN_PATHS } from '../App.js';

type Confirm = { paid: boolean; entitlement: Entitlement } | null;
const billingWith = (statuses: string[], confirm: Confirm = null) => {
  let i = 0;
  return {
    status: async (): Promise<Entitlement | null> => ({ entitled: true, status: statuses[Math.min(i++, statuses.length - 1)]! } as Entitlement),
    // [P14-4a] null = the server could not confirm this session → the component falls back to polling status.
    confirmSuccess: async (): Promise<Confirm> => confirm,
  };
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

  // [P14-4a] A PAID session for this rep is confirmed server-side immediately — no polling needed.
  it('success: a server-confirmed paid session says "You\'re subscribed" without waiting on status', async () => {
    window.history.replaceState({}, '', '/billing/success?plan=monthly&session_id=cs_test_abc');
    const paid: Confirm = { paid: true, entitlement: { entitled: true, status: 'active' } as Entitlement };
    // status() would keep returning 'trialing' — only the server confirm should drive this.
    render(<BillingReturn mode="success" billing={billingWith(['trialing'], paid)} pollMs={1} />);
    expect(await screen.findByText(/you're subscribed to the monthly plan/i)).toBeInTheDocument();
  });

  // [P14-4a] The BUG fixed: landing on /billing/success with NO confirmable payment must NEVER claim
  // "payment received". It shows a neutral message and routes to Settings.
  it('success: when nothing confirms (no/other session, status never flips), it does NOT claim payment', async () => {
    const onNavigate = vi.fn();
    render(<BillingReturn mode="success" billing={billingWith(['trialing'])} onNavigate={onNavigate} pollMs={1} maxTries={2} />);
    expect(screen.getByRole('status')).toHaveTextContent(/confirming your payment/i);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/couldn't confirm a payment/i));
    // never the false claim
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /go to settings/i }));
    expect(onNavigate).toHaveBeenCalledWith('/app?view=settings');
  });

  it('top-up: shows "Top-up added" and never confirms/polls for a subscription', async () => {
    window.history.replaceState({}, '', '/billing/success?topup=1');
    const status = vi.fn();
    const confirmSuccess = vi.fn();
    render(<BillingReturn mode="success" billing={{ status, confirmSuccess }} />);
    expect(screen.getByText(/top-up has been added/i)).toBeInTheDocument();
    expect(status).not.toHaveBeenCalled();
    expect(confirmSuccess).not.toHaveBeenCalled();
  });

  it('every configured return path is a known SPA route (never a 404)', () => {
    for (const p of BILLING_RETURN_PATHS) expect(KNOWN_SPA_PATHS.has(p)).toBe(true);
  });
});
