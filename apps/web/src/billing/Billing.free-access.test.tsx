import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Billing, type BillingApi } from './Billing.js';
import type { Entitlement } from './billingClient.js';

/**
 * [P72-2 · owner] Free access from Admin: the Subscription page shows the plan as active with the line
 * "Free access from Tovira", no renewal date and no Manage subscription (there is no Stripe subscription behind it),
 * and no Subscribe buttons.
 */
const api = (e: Entitlement): BillingApi => ({ status: vi.fn().mockResolvedValue(e), checkout: vi.fn(), portal: vi.fn() });

describe('[P72-2] Subscription page with free access', () => {
  it('shows "Free access from Tovira"', async () => {
    render(<Billing api={api({ entitled: true, status: 'active', trialEndsAt: 0, renewsAt: null, freeAccess: true })} />);
    expect(await screen.findByTestId('free-access')).toHaveTextContent('Free access from Tovira');
  });
  it('NEGATIVE: no renewal date, no Manage subscription, no Subscribe, no "You\'re subscribed"', async () => {
    render(<Billing api={api({ entitled: true, status: 'active', trialEndsAt: 0, renewsAt: Date.parse('2026-12-17'), freeAccess: true })} />);
    await screen.findByTestId('free-access');
    expect(screen.queryByTestId('renews-at')).toBeNull();
    expect(screen.queryByRole('button', { name: /manage subscription/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
    expect(screen.queryByText(/you're subscribed/i)).toBeNull();
  });
  it('NEGATIVE: a paid Stripe subscriber still sees the paid plan, not the free-access line', async () => {
    render(<Billing api={api({ entitled: true, status: 'active', trialEndsAt: 0 })} />);
    expect(await screen.findByText(/you're subscribed/i)).toBeInTheDocument();
    expect(screen.queryByTestId('free-access')).toBeNull();
    expect(screen.getByRole('button', { name: /manage subscription/i })).toBeInTheDocument();
  });
});
