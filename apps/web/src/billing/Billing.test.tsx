import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Billing, type BillingApi } from './Billing.js';
import type { Entitlement } from './billingClient.js';

const NOW = Date.parse('2026-07-15T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function makeApi(status: Entitlement | null, url: string | null = 'https://checkout.test/x'): BillingApi {
  return { status: vi.fn().mockResolvedValue(status), checkout: vi.fn().mockResolvedValue(url) };
}

describe('<Billing>', () => {
  it('shows trial days remaining and a Subscribe button', async () => {
    render(<Billing api={makeApi({ entitled: true, status: 'trialing', trialEndsAt: NOW + 3 * DAY })} now={NOW} />);
    expect(await screen.findByTestId('trial-status')).toHaveTextContent(/3 days left/i);
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument();
  });

  it('shows the subscribed state and hides Subscribe when active', async () => {
    render(<Billing api={makeApi({ entitled: true, status: 'active', trialEndsAt: 0 })} now={NOW} />);
    expect(await screen.findByText(/you're subscribed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
  });

  it('shows an expired state when the trial has ended', async () => {
    render(<Billing api={makeApi({ entitled: false, status: 'none', trialEndsAt: NOW - DAY })} now={NOW} />);
    expect(await screen.findByTestId('expired')).toBeInTheDocument();
  });

  it('flags a past-due payment', async () => {
    render(<Billing api={makeApi({ entitled: false, status: 'past_due', trialEndsAt: 0 })} now={NOW} />);
    expect(await screen.findByTestId('past-due')).toBeInTheDocument();
  });

  // POSITIVE: Subscribe starts checkout and redirects to the returned URL.
  it('starts checkout and redirects on Subscribe', async () => {
    const user = userEvent.setup();
    const onRedirect = vi.fn();
    const api = makeApi({ entitled: true, status: 'trialing', trialEndsAt: NOW + DAY }, 'https://checkout.test/go');
    render(<Billing api={api} now={NOW} onRedirect={onRedirect} />);
    await user.click(await screen.findByRole('button', { name: /subscribe/i }));
    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith('https://checkout.test/go'));
  });

  // NEGATIVE: a failed checkout shows an error and does not redirect.
  it('shows an error when checkout fails', async () => {
    const user = userEvent.setup();
    const onRedirect = vi.fn();
    render(<Billing api={makeApi({ entitled: true, status: 'trialing', trialEndsAt: NOW + DAY }, null)} now={NOW} onRedirect={onRedirect} />);
    await user.click(await screen.findByRole('button', { name: /subscribe/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onRedirect).not.toHaveBeenCalled();
  });
});
