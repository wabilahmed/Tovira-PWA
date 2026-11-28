import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Locked } from './Locked.js';

// [P69 · owner] "Reading…" → "Analysing…" everywhere (one voice): the pinned wording below changed by owner decision.

describe('<Locked>', () => {
  it('shows the calm reopen-your-book copy and a Subscribe action', async () => {
    const onSubscribe = vi.fn();
    render(<Locked onSubscribe={onSubscribe} />);
    expect(screen.getByRole('status')).toHaveTextContent(/your trial has ended\. subscribe to reopen your book\./i);
    expect(screen.getByTestId('subscribe-upsell')).toHaveTextContent('Subscribing gives you 10,000 messages a month.'); // [P37 · owner] was "…to the full AED 60."; [P83] in messages
    // [P90-3 · owner, Prompt 88] moved: the annual plan is hidden until its checkout is proven, so the prompt offers monthly only
    await userEvent.click(screen.getByTestId('subscribe-monthly'));
    expect(onSubscribe).toHaveBeenLastCalledWith('monthly');
  });

  // [P16-3a] An account that never had a trial (status 'none') must NOT be told its trial "ended".
  it('invites a never-trialed account (status none) to start — never "trial has ended"', () => {
    render(<Locked onSubscribe={vi.fn()} status="none" />);
    expect(screen.getByRole('status')).toHaveTextContent(/subscribe to start analysing your conversations/i);
    expect(screen.queryByText(/trial has ended/i)).toBeNull();
  });

  it('keeps "trial has ended" for an actually-expired trial', () => {
    render(<Locked onSubscribe={vi.fn()} status="trial_expired" />);
    expect(screen.getByRole('status')).toHaveTextContent(/your trial has ended/i);
  });
});
