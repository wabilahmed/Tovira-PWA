import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubscribeNow, ALLOWANCE_RESET_LINE } from './SubscribeUpsell.js';
import { PLANS } from './plans.js';

describe('<SubscribeNow>', () => {
  // [P90-3 · owner, Prompt 88] moved: "hide the annual price until annual checkout is proven end to end". The prompt
  // offered both plans with yearly as the primary action; now monthly is the one action (and the primary one).
  it('offers the monthly plan, starting checkout for it, with the reset line', async () => {
    const onSubscribe = vi.fn();
    render(<SubscribeNow onSubscribe={onSubscribe} />);

    expect(screen.queryByRole('button', { name: /AED 2,990 \/ year/i })).toBeNull();
    const monthly = screen.getByRole('button', { name: /AED 299 \/ month/i });
    expect(monthly).toHaveClass('tov-primary');
    expect(screen.getByTestId('subscribe-upsell')).toHaveTextContent(ALLOWANCE_RESET_LINE);

    await userEvent.click(monthly);
    expect(onSubscribe).toHaveBeenLastCalledWith('monthly');
  });

  it('shows the prices from the shared PLANS source (no divergent hardcoded numbers)', () => {
    render(<SubscribeNow onSubscribe={vi.fn()} />);
    expect(screen.getByRole('button', { name: new RegExp(PLANS.monthly.price.replace('/', '\\/'), 'i') })).toBeInTheDocument();
    expect(PLANS.annual.price).toBe('AED 2,990 / year'); // [P90-3] kept in the shared source for when it returns
  });
});
