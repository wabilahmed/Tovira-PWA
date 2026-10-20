import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroInsights, type HeroApi } from './HeroInsights.js';
import { PRIMARY, SIDEBAR, OVERFLOW, isView } from '../shell/nav.js';

/**
 * [P34-1] Phone review, 20 Oct: "Today's register" read like a sign-up or a cash register. The screen is
 * "Today" everywhere a rep sees it — nav labels, heading, landmark label, empty state. Its deep link was
 * always `?view=today` (no "register" in any URL), so there is no old route to redirect.
 */
const api = (): HeroApi => ({
  status: vi.fn().mockResolvedValue({ unlocked: true, counts: { clients: 5, notes: 20 }, needed: { clients: 0, notes: 0 }, message: '' }),
  patterns: vi.fn().mockResolvedValue([]),
  risk: vi.fn().mockResolvedValue([]),
  today: vi.fn().mockResolvedValue({ actions: [], refreshesRemaining: 2 }),
  refreshToday: vi.fn().mockResolvedValue(null),
});

describe('[P34-1] the screen is called "Today"', () => {
  it('the nav labels it "Today" (bottom bar, sidebar) and nothing says "register"', () => {
    for (const items of [PRIMARY, SIDEBAR, OVERFLOW]) {
      const today = items.find((i) => i.view === 'today');
      if (today) expect(today.label).toBe('Today');
      for (const i of items) expect(i.label).not.toMatch(/register/i);
    }
  });

  it('the heading and landmark say "Today"; the empty state never says "register"', async () => {
    const { container } = render(<HeroInsights api={api()} />);
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/register/i);
  });

  it('the deep link stays ?view=today', () => {
    expect(isView('today')).toBe(true);
  });
});
