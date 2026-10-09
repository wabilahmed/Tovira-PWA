import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubscribeNow, ALLOWANCE_RESET_LINE } from './SubscribeUpsell.js';
import { PLANS } from './plans.js';

describe('<SubscribeNow>', () => {
  it('offers both plans, each starting checkout for the right plan, with the reset line', async () => {
    const onSubscribe = vi.fn();
    render(<SubscribeNow onSubscribe={onSubscribe} />);

    const yearly = screen.getByRole('button', { name: /AED 2,990 \/ year/i });
    const monthly = screen.getByRole('button', { name: /AED 299 \/ month/i });
    expect(yearly).toHaveTextContent(/save AED 598/i);
    // the yearly plan is the visually primary action
    expect(yearly).toHaveClass('tov-primary');
    expect(monthly).not.toHaveClass('tov-primary');
    expect(screen.getByTestId('subscribe-upsell')).toHaveTextContent(ALLOWANCE_RESET_LINE);

    await userEvent.click(yearly);
    expect(onSubscribe).toHaveBeenLastCalledWith('annual');
    await userEvent.click(monthly);
    expect(onSubscribe).toHaveBeenLastCalledWith('monthly');
  });

  it('shows the prices from the shared PLANS source (no divergent hardcoded numbers)', () => {
    render(<SubscribeNow onSubscribe={vi.fn()} />);
    expect(screen.getByRole('button', { name: new RegExp(PLANS.monthly.price.replace('/', '\\/'), 'i') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(PLANS.annual.price.replace('/', '\\/'), 'i') })).toBeInTheDocument();
  });
});
