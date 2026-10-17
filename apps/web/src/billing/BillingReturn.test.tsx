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
    // Real success URLs carry a session_id (P14-2); here the server confirm returns null so the status
    // poll (→ active) drives it — the webhook-already-landed path.
    window.history.replaceState({}, '', '/billing/success?plan=annual&session_id=cs_x');
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

  // [P16-3b] With NO session_id there is nothing to confirm — show the neutral state IMMEDIATELY and do
  // not poll (previously it polled ~20s first). Never "Confirming…", never "payment received".
  it('success: no session_id → straight to "couldn\'t confirm", no polling, no confirm call', async () => {
    const onNavigate = vi.fn();
    const confirmSuccess = vi.fn();
    const status = vi.fn();
    render(<BillingReturn mode="success" billing={{ status, confirmSuccess }} onNavigate={onNavigate} pollMs={1} maxTries={2} />);
    expect(await screen.findByText(/couldn't confirm a payment/i)).toBeInTheDocument();
    expect(screen.queryByText(/confirming your payment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
    expect(confirmSuccess).not.toHaveBeenCalled(); // nothing to confirm
    expect(status).not.toHaveBeenCalled();         // nothing to poll
    await userEvent.click(screen.getByRole('button', { name: /go to settings/i }));
    expect(onNavigate).toHaveBeenCalledWith('/app?view=settings');
  });

  // [P14-4a] A session_id that doesn't confirm (webhook in flight, status never flips) still ends neutral,
  // never claiming payment — after the short poll, not before.
  it('success: an unconfirmable session polls, then does NOT claim payment', async () => {
    window.history.replaceState({}, '', '/billing/success?session_id=cs_unknown');
    render(<BillingReturn mode="success" billing={billingWith(['trialing'])} pollMs={1} maxTries={2} />);
    expect(screen.getByRole('status')).toHaveTextContent(/confirming your payment/i);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/couldn't confirm a payment/i));
    expect(screen.queryByText(/payment received/i)).not.toBeInTheDocument();
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
