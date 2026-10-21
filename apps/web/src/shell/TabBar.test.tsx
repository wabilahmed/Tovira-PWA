import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabBar } from './TabBar.js';

describe('<TabBar>', () => {
  // [P39 · owner] Clients · Today · Find · Book Scan · More (Ask became Find).
  it('shows the four primary tabs and More', () => {
    render(<TabBar view="clients" onNavigate={vi.fn()} />);
    for (const name of [/clients/i, /today/i, /^find$/i, /book scan/i, /^more$/i]) {
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

  // [P39 · owner] The same five tabs on every screen — an overflow section never takes Book Scan's slot (seen:
  // To Confirm replaced it). A sub-screen highlights its parent: overflow screens → More, To Confirm → Today.
  it('never replaces a tab: an overflow screen highlights More, To Confirm highlights Today', () => {
    const { rerender } = render(<TabBar view="alerts" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /book scan/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^alerts$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^more$/i })).toHaveAttribute('aria-current', 'page');
    rerender(<TabBar view="confirm" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /book scan/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /today/i })).toHaveAttribute('aria-current', 'page');
  });
});
