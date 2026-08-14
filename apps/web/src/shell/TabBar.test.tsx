import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabBar } from './TabBar.js';

describe('<TabBar>', () => {
  it('shows the four primary tabs and More', () => {
    render(<TabBar view="clients" onNavigate={vi.fn()} />);
    for (const name of [/clients/i, /today/i, /^ask$/i, /book scan/i, /^more$/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // Overflow sections are not in the bar until More is opened.
    expect(screen.queryByRole('button', { name: /promises/i })).toBeNull();
  });

  it('marks the active tab with aria-current', () => {
    render(<TabBar view="today" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /today/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /clients/i })).not.toHaveAttribute('aria-current');
  });

  it('navigates on a primary tap', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<TabBar view="clients" onNavigate={onNavigate} />);
    await user.click(screen.getByRole('button', { name: /book scan/i }));
    expect(onNavigate).toHaveBeenCalledWith('bookscan');
  });

  it('opens More and navigates to an overflow section', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<TabBar view="clients" onNavigate={onNavigate} />);
    await user.click(screen.getByRole('button', { name: /^more$/i }));
    await user.click(await screen.findByRole('button', { name: /the monday statement/i }));
    expect(onNavigate).toHaveBeenCalledWith('week');
  });

  it('gives the fourth slot to the active overflow section (Book Scan steps aside)', () => {
    render(<TabBar view="alerts" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /alerts/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: /book scan/i })).toBeNull();
  });
});
