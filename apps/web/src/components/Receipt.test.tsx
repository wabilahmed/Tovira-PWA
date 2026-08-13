import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Receipt } from './Receipt.js';

// [RECEIPT §5] One chit everywhere a quote+date backs a claim.
describe('<Receipt>', () => {
  it('shows the quote and a mono stamp "SOURCE · DD MON YYYY"', () => {
    render(<Receipt quote="pricing is too high" source="whatsapp" date="2026-03-14" />);
    const el = screen.getByTestId('receipt');
    expect(el).toHaveTextContent(/pricing is too high/);
    expect(el).toHaveTextContent(/14 MAR 2026/);
    // source rendered (CSS uppercases it; the DOM text is the raw value)
    expect(el).toHaveTextContent(/whatsapp/i);
  });

  it('formats the date through the one formatter (never a slash date)', () => {
    render(<Receipt quote="q" date="2026-01-16T10:00:00" />);
    expect(screen.getByTestId('receipt')).toHaveTextContent(/16 JAN 2026/);
    expect(screen.getByTestId('receipt').textContent).not.toMatch(/\d\/\d/);
  });

  it('shows the quote with no stamp when neither source nor date is given', () => {
    render(<Receipt quote="just a quote" />);
    const el = screen.getByTestId('receipt');
    expect(el).toHaveTextContent(/just a quote/);
    expect(el.querySelector('.tov-stamp')).toBeNull();
  });

  it('opens the source on tap when onOpen is provided (a real button role)', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Receipt quote="q" source="whatsapp" date="2026-03-14" onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: /open source/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('is not a button when it has nowhere to open', () => {
    render(<Receipt quote="q" date="2026-03-14" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
