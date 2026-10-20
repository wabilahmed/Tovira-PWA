import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Billing } from './Billing.js';

/** [P37] A failed payment (the server's 'payment_failed', or 'past_due') updates its card in the billing portal —
 *  it is never offered Subscribe (which would start a second subscription). */
describe('[P37] Subscription with a failed payment', () => {
  for (const status of ['payment_failed', 'past_due']) {
    it(`${status}: "Update your card", no Subscribe buttons`, async () => {
      const api = { status: vi.fn(async () => ({ entitled: true, status, trialEndsAt: 0, renewsAt: null })), checkout: vi.fn(), portal: vi.fn() };
      render(<Billing api={api as never} />);
      expect(await screen.findByTestId('past-due')).toHaveTextContent('Your last payment failed. Update your card to keep access.');
      expect(screen.getByRole('button', { name: 'Update your card' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /subscribe/i })).toBeNull();
    });
  }
});
