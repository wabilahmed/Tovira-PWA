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
  it('shows trial days remaining and monthly + annual Subscribe buttons', async () => {
    render(<Billing api={makeApi({ entitled: true, status: 'trialing', trialEndsAt: NOW + 3 * DAY })} now={NOW} />);
    expect(await screen.findByTestId('trial-status')).toHaveTextContent(/3 days left/i);
    expect(screen.getByRole('button', { name: /subscribe monthly/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /subscribe annually/i })).toBeInTheDocument();
  });

  // [P5-5] the annual price is shown as a yearly charge, never as a monthly one.
  it('shows the annual price as yearly, never as a monthly charge', async () => {
    render(<Billing api={makeApi({ entitled: false, status: 'none', trialEndsAt: 0 })} now={NOW} />);
    const annual = await screen.findByRole('button', { name: /subscribe annually/i });
    expect(annual).toHaveTextContent(/AED 2,990 \/ year/);
    expect(annual).not.toHaveTextContent(/2,990 \/ month/);
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

  // POSITIVE: each plan starts checkout for that plan and redirects.
  it('starts monthly and annual checkout for the chosen plan', async () => {
    const user = userEvent.setup();
    const onRedirect = vi.fn();
    const api = makeApi({ entitled: true, status: 'trialing', trialEndsAt: NOW + DAY }, 'https://checkout.test/go');
    render(<Billing api={api} now={NOW} onRedirect={onRedirect} />);
    await user.click(await screen.findByRole('button', { name: /subscribe monthly/i }));
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('monthly'));
    await user.click(screen.getByRole('button', { name: /subscribe annually/i }));
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('annual'));
    expect(onRedirect).toHaveBeenCalledWith('https://checkout.test/go');
  });

  // NEGATIVE: a failed checkout shows an error and does not redirect.
  it('shows an error when checkout fails', async () => {
    const user = userEvent.setup();
    const onRedirect = vi.fn();
    render(<Billing api={makeApi({ entitled: true, status: 'trialing', trialEndsAt: NOW + DAY }, null)} now={NOW} onRedirect={onRedirect} />);
    await user.click(await screen.findByRole('button', { name: /subscribe monthly/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onRedirect).not.toHaveBeenCalled();
  });
});
