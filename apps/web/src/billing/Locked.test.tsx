import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Locked } from './Locked.js';

describe('<Locked>', () => {
  it('shows the calm reopen-your-book copy and a Subscribe action', async () => {
    const onSubscribe = vi.fn();
    render(<Locked onSubscribe={onSubscribe} />);
    expect(screen.getByRole('status')).toHaveTextContent(/your trial has ended\. subscribe to reopen your book\./i);
    expect(screen.getByTestId('subscribe-upsell')).toHaveTextContent(/resets your AI allowance to the full AED 60/i);
    await userEvent.click(screen.getByTestId('subscribe-annual'));
    expect(onSubscribe).toHaveBeenLastCalledWith('annual');
  });
});
