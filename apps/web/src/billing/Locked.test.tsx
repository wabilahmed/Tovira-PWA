import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Locked } from './Locked.js';

describe('<Locked>', () => {
  it('shows the calm reopen-your-book copy and a Subscribe action', async () => {
    const onSubscribe = vi.fn();
    render(<Locked onSubscribe={onSubscribe} />);
    expect(screen.getByRole('status')).toHaveTextContent(/your trial has ended\. subscribe to reopen your book\./i);
    await userEvent.click(screen.getByRole('button', { name: /subscribe/i }));
    expect(onSubscribe).toHaveBeenCalledTimes(1);
  });
});
