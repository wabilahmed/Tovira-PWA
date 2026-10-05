import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Billing, type BillingApi } from './Billing.js';
import type { Entitlement } from './billingClient.js';

const NOW = Date.parse('2026-07-15T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function makeApi(status: Entitlement | null, url: string | null = 'https://checkout.test/x', portalUrl: string | null = 'https://portal.test/x'): BillingApi {
  return { status: vi.fn().mockResolvedValue(status), checkout: vi.fn().mockResolvedValue(url), portal: vi.fn().mockResolvedValue(portalUrl) };
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

  // [P5-2] the renewal date comes from the webhook and renders as a mono stamp.
  it('shows the renewal date when active and a period end is known', async () => {
    const renewsAt = Date.parse('2026-09-14T00:00:00Z');
    render(<Billing api={makeApi({ entitled: true, status: 'active', trialEndsAt: 0, renewsAt })} now={NOW} />);
    expect(await screen.findByTestId('renews-at')).toHaveTextContent(/Renews\s+14 SEP 2026/i);
  });

  // NEGATIVE: no period end → no invented renewal line.
  it('shows no renewal line when the period end is unknown', async () => {
    render(<Billing api={makeApi({ entitled: true, status: 'active', trialEndsAt: 0, renewsAt: null })} now={NOW} />);
    await screen.findByText(/you're subscribed/i);
    expect(screen.queryByTestId('renews-at')).toBeNull();
  });

  // [FLOWS/HOUSEKEEPING] canceled gets its OWN copy, distinct from "trial ended".
  it('shows a distinct canceled state, not the trial-ended copy', async () => {
    render(<Billing api={makeApi({ entitled: false, status: 'canceled', trialEndsAt: 0 })} now={NOW} />);
    expect(await screen.findByTestId('canceled')).toHaveTextContent(/subscription is canceled.*resubscribe/i);
    expect(screen.queryByTestId('expired')).toBeNull();
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

  // [TASK 3] The checkout disclosure renders beside the plans, with a working Terms link.
  it('shows the checkout disclosure beside the plans (VAT, renewal, cancellation, period-end) + a Terms link', async () => {
    render(<Billing api={makeApi({ entitled: false, status: 'none', trialEndsAt: 0 })} now={NOW} />);
    const disclosure = await screen.findByTestId('checkout-disclosure');
    expect(disclosure).toHaveTextContent(/includes? VAT/i); // prices include VAT
    expect(disclosure).toHaveTextContent(/same date and time/i); // renews at the same date & time
    expect(disclosure).toHaveTextContent(/cancel anytime from Billing/i); // cancel from Billing
    expect(disclosure).toHaveTextContent(/until the end of the period you have paid for/i); // access to period end
    const terms = screen.getByRole('link', { name: /terms/i });
    expect(terms.getAttribute('href')).toBe('/terms');
  });

  // [TASK 3] When subscribed, a "Manage subscription" button opens the Stripe Customer Portal.
  it('offers Manage subscription when active and opens the portal', async () => {
    const user = userEvent.setup();
    const onRedirect = vi.fn();
    const api = makeApi({ entitled: true, status: 'active', trialEndsAt: 0 }, 'https://checkout.test/x', 'https://portal.test/go');
    render(<Billing api={api} now={NOW} onRedirect={onRedirect} />);
    const manage = await screen.findByRole('button', { name: /manage subscription/i });
    await user.click(manage);
    await waitFor(() => expect(api.portal).toHaveBeenCalled());
    expect(onRedirect).toHaveBeenCalledWith('https://portal.test/go');
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
