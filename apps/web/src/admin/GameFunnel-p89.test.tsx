import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GameFunnelCard } from './GameFunnel.js';
import type { GameFunnel, GameWindow } from './adminClient.js';

/**
 * [P89 · owner, Prompt 86] "Add them to the existing admin funnel card": the landing scene's counts (how many visits
 * reached each of the five beats, which Start free was tapped, game banner taps) and the game pages (views and starts by
 * page), in the same Game funnel card, for the same 7 or 30 days. A response from before P89 (no landing block) still renders.
 */
const base = (): GameWindow => ({ steps: [], byIndustry: [], wrongShare: [1, 2, 3, 4, 5].map((chat) => ({ chat, chats: 0, wrong: 0, pct: null })) });
const W: GameWindow = {
  ...base(),
  landing: {
    beats: [{ beat: 1, n: 100 }, { beat: 2, n: 70 }, { beat: 3, n: 55 }, { beat: 4, n: 40 }, { beat: 5, n: 31 }],
    starts: [{ place: 'header', n: 4 }, { place: 'beat1', n: 9 }, { place: 'beat5', n: 6 }, { place: 'pricing', n: 3 }, { place: 'closing', n: 2 }, { place: 'game_close', n: 1 }],
    banner: 12,
  },
  byRoute: [{ route: '/game', views: 20, starts: 0 }, { route: '/game/wealth', views: 8, starts: 7 }],
};

describe('[P89] the landing scene in the Game funnel card', () => {
  it('shows each beat reached, Start free taps by place, banner taps, and views and starts by game page', () => {
    render(<GameFunnelCard game={{ '7d': W, '30d': W } as GameFunnel} />);
    const scene = screen.getByTestId('landing-scene');
    expect(within(scene).getByTestId('beat-1').textContent).toContain('100');
    expect(within(scene).getByTestId('beat-5').textContent).toMatch(/31/);
    expect(within(scene).getByTestId('beat-5').textContent).toMatch(/31%/); // share of visits that reached beat 1
    expect(within(scene).getByTestId('start-beat1').textContent).toContain('9');
    expect(within(scene).getByTestId('start-game_close').textContent).toContain('1');
    expect(within(scene).getByTestId('banner').textContent).toContain('12');
    const pages = screen.getByTestId('game-by-route');
    expect(within(pages).getByText('/game/wealth').closest('tr')!.textContent).toMatch(/8\s*7|87/);
  });
  it('a response without the landing block (older API) still renders the game funnel', () => {
    render(<GameFunnelCard game={{ '7d': base(), '30d': base() } as GameFunnel} />);
    expect(screen.getByTestId('game-funnel')).toBeTruthy();
    expect(screen.queryByTestId('landing-scene')).toBeNull();
  });
});
