import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ANNUAL_AVAILABLE } from './plans.js';
import { SubscribeNow } from './SubscribeUpsell.js';
import { Locked } from './Locked.js';
import { Billing } from './Billing.js';

/**
 * [P90-3 · owner, Prompt 88] "The trial Subscription screen: hide the annual price until annual checkout is proven end
 * to end." Annual checkout is not proven (Stripe has no yearly price: BLOCKERS [P89-annual]), so no screen in the app
 * offers it: the trial Subscription screen and every Subscribe prompt show the monthly plan only. One switch,
 * ANNUAL_AVAILABLE in plans.ts, brings it back when the checkout is proven.
 */
describe('[P90-3] the annual plan is not offered until its checkout is proven', () => {
  it('the switch is off', () => { expect(ANNUAL_AVAILABLE).toBe(false); });
  it('the trial Subscription screen: monthly only, no annual price or button', async () => {
    const api = { status: async () => ({ entitled: true, status: 'trialing', trialEndsAt: Date.now() + 9 * 86_400_000 }), checkout: vi.fn(async () => null), portal: async () => null };
    const { container } = render(<Billing api={api as never} />);
    expect(await screen.findByRole('button', { name: /Subscribe monthly: AED 299 \/ month/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /annual/i })).toBeNull();
    expect(container.textContent).not.toMatch(/2,990|annually|2 months free/);
  });
  it('every Subscribe prompt (trial ended, messages used up): the monthly plan only, and it goes to monthly checkout', async () => {
    const onSubscribe = vi.fn();
    const { container } = render(<SubscribeNow onSubscribe={onSubscribe} />);
    expect(screen.queryByTestId('subscribe-annual')).toBeNull();
    expect(container.textContent).not.toMatch(/2,990|save AED/);
    await userEvent.click(screen.getByTestId('subscribe-monthly'));
    expect(onSubscribe).toHaveBeenCalledWith('monthly');
    await waitFor(() => expect(onSubscribe).toHaveBeenCalledTimes(1));
  });
  it('the locked screen offers monthly only', () => {
    const { container } = render(<Locked onSubscribe={vi.fn()} />);
    expect(screen.getByTestId('subscribe-monthly')).toHaveTextContent('AED 299 / month');
    expect(container.textContent).not.toMatch(/2,990/);
  });
});

/**
 * [P90-2 · owner, Prompt 88] "A suspended paying account must see the payment message, not 'trial ended'."
 */
describe('[P90-2] a locked screen after a failed payment', () => {
  for (const status of ['suspended', 'past_due', 'payment_failed']) {
    it(`status ${status}: the payment message, never "trial ended", and no second Subscribe`, () => {
      render(<Locked onSubscribe={vi.fn()} status={status} />);
      expect(screen.getByRole('status')).toHaveTextContent('Your last payment failed. Update your payment details to reopen your book.');
      expect(screen.queryByText(/trial has ended/i)).toBeNull();
      expect(screen.queryByTestId('subscribe-upsell')).toBeNull(); // subscribing again would start a second subscription
    });
  }
  it('NEGATIVE: an expired trial still reads "Your trial has ended."', () => {
    render(<Locked onSubscribe={vi.fn()} status="trial_expired" />);
    expect(screen.getByRole('status')).toHaveTextContent(/your trial has ended/i);
    expect(screen.getByTestId('subscribe-upsell')).toBeInTheDocument();
  });
});
