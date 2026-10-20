import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Locked } from './Locked.js';

describe('<Locked>', () => {
  it('shows the calm reopen-your-book copy and a Subscribe action', async () => {
    const onSubscribe = vi.fn();
    render(<Locked onSubscribe={onSubscribe} />);
    expect(screen.getByRole('status')).toHaveTextContent(/your trial has ended\. subscribe to reopen your book\./i);
    expect(screen.getByTestId('subscribe-upsell')).toHaveTextContent("Subscribing gives you a full month's allowance."); // [P37 · owner] was "…to the full AED 60."
    await userEvent.click(screen.getByTestId('subscribe-annual'));
    expect(onSubscribe).toHaveBeenLastCalledWith('annual');
  });

  // [P16-3a] An account that never had a trial (status 'none') must NOT be told its trial "ended".
  it('invites a never-trialed account (status none) to start — never "trial has ended"', () => {
    render(<Locked onSubscribe={vi.fn()} status="none" />);
    expect(screen.getByRole('status')).toHaveTextContent(/subscribe to start reading your chats/i);
    expect(screen.queryByText(/trial has ended/i)).toBeNull();
  });

  it('keeps "trial has ended" for an actually-expired trial', () => {
    render(<Locked onSubscribe={vi.fn()} status="trial_expired" />);
    expect(screen.getByRole('status')).toHaveTextContent(/your trial has ended/i);
  });
});
