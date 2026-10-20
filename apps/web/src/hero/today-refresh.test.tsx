import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroInsights, type HeroApi } from './HeroInsights.js';

/**
 * [P34-5] Phone review, 20 Oct: "1 refresh left today." exposed the cost limit and read as stingy. While a
 * refresh is left the screen shows only the Refresh button — no counter. With none left (on load, after the
 * last refresh, or a 429) the button is disabled and the copy says what happens instead. The limit itself is
 * unchanged.
 */
const DONE = 'Updated overnight. Next refresh tomorrow.';
const api = (remainingOnLoad: number, refresh: HeroApi['refreshToday'] = vi.fn().mockResolvedValue({ actions: [], refreshesRemaining: 1 })): HeroApi => ({
  status: vi.fn().mockResolvedValue({ unlocked: true, counts: { clients: 5, notes: 20 }, needed: { clients: 0, notes: 0 }, message: '' }),
  patterns: vi.fn().mockResolvedValue([]),
  risk: vi.fn().mockResolvedValue([]),
  today: vi.fn().mockResolvedValue({ actions: [], refreshesRemaining: remainingOnLoad }),
  refreshToday: refresh,
});

describe('[P34-5] the refresh counter stays hidden until it matters', () => {
  it('refreshes left (on load and after a refresh) → just the Refresh button, no counter', async () => {
    const { container } = render(<HeroInsights api={api(2)} />);
    const button = await screen.findByRole('button', { name: 'Refresh' });
    expect(button).toBeEnabled();
    expect(container.textContent).not.toMatch(/refresh(es)? left|left today|no more refreshes/i);
    await userEvent.click(button);
    await screen.findByRole('button', { name: 'Refresh' });
    expect(container.textContent).not.toMatch(/refresh(es)? left|left today/i);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('none left on load → the button is disabled with the overnight copy', async () => {
    render(<HeroInsights api={api(0)} />);
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('the last refresh used up → disabled with the overnight copy', async () => {
    render(<HeroInsights api={api(1, vi.fn().mockResolvedValue({ actions: [], refreshesRemaining: 0 }))} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('a server 429 (limit reached) reads the same way', async () => {
    render(<HeroInsights api={api(1, vi.fn().mockResolvedValue('rate_limited'))} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});
