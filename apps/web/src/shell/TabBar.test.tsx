import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabBar } from './TabBar.js';
import { activeTab } from './nav.js';

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

  // [P46-1] "← More" on a More sub-page (Inventory, the Ledger) reopens the More sheet.
  it('a More request from the page opens the More sheet', async () => {
    const { rerender } = render(<TabBar view="inventory" onNavigate={vi.fn()} moreRequest={0} />);
    expect(screen.queryByRole('button', { name: /the monday statement/i })).toBeNull();
    rerender(<TabBar view="inventory" onNavigate={vi.fn()} moreRequest={1} />);
    expect(await screen.findByRole('button', { name: /the monday statement/i })).toBeInTheDocument();
  });
});

// [P46-2] Owner (phone review): on a More sub-page the marker sat under Today while More was highlighted. The marker
// and the highlighted label always match: on every primary screen, every More sub-page, and while the More sheet is open.
describe('[P46-2] the marker follows the highlighted tab', () => {
  // jsdom has no layout: give each tab a 78px slot so the marker can be measured.
  function layout(): void {
    const nav = document.querySelector('nav.tov-tabbar') as HTMLElement;
    nav.getBoundingClientRect = () => ({ left: 0, top: 0, right: 390, bottom: 60, width: 390, height: 60, x: 0, y: 0, toJSON: () => ({}) });
    [...nav.querySelectorAll<HTMLElement>('button.tov-tab')].forEach((b, i) => {
      b.getBoundingClientRect = () => ({ left: i * 78, top: 0, right: i * 78 + 78, bottom: 60, width: 78, height: 60, x: i * 78, y: 0, toJSON: () => ({}) });
    });
  }
  const markerX = (): number => Number(/translateX\((-?[\d.]+)px\)/.exec((document.querySelector('.tov-tab__marker') as HTMLElement).style.transform)?.[1] ?? NaN);
  const highlightedX = (): number => {
    const tabs = [...document.querySelectorAll<HTMLElement>('nav.tov-tabbar button.tov-tab')];
    return tabs.findIndex((b) => b.dataset.active !== undefined) * 78;
  };

  for (const view of ['clients', 'today', 'find', 'bookscan', 'confirm', 'inventory', 'ledger', 'settings', 'subscription', 'account', 'promises', 'week'] as const) {
    it(`${view}: the marker sits under the highlighted tab`, () => {
      // start on a different tab, so the move to this one is measured after layout
      const { rerender } = render(<TabBar view={activeTab(view) === 'find' ? 'clients' : 'find'} onNavigate={vi.fn()} />);
      layout();
      rerender(<TabBar view={view} onNavigate={vi.fn()} />);
      expect(markerX()).toBe(highlightedX());
    });
  }

  it('the open More sheet moves the marker to More, and closing it puts it back', async () => {
    render(<TabBar view="today" onNavigate={vi.fn()} />);
    layout();
    await userEvent.click(screen.getByRole('button', { name: /^more$/i }));
    expect(markerX()).toBe(4 * 78);
    expect(markerX()).toBe(highlightedX());
    await userEvent.keyboard('{Escape}'); // close the sheet
    await waitFor(() => expect(markerX()).toBeCloseTo(1 * 78, 0), { timeout: 3000 }); // springs back under Today
    expect(highlightedX()).toBe(1 * 78);
  });
});
