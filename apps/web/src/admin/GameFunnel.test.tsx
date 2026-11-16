import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameFunnelCard } from './GameFunnel.js';
import type { GameFunnel, GameWindow } from './adminClient.js';

/**
 * [P71-T · owner] Admin → Funnel's "Game funnel" card, next to the site visits: view → start → chat 1 done → chat 5 done
 * → end screen → CTA tap → sign-up, with counts and the % drop at each step, for 7 and 30 days, split by industry, and
 * the share of chats a wrong tap ended per chat number ("that's where people give up").
 */
const INDUSTRIES = ['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment'] as const;
const LABELS = ['Saw the game', 'Picked an industry', 'Finished chat 1', 'Finished chat 5', 'Saw the end screen', 'Tapped the CTA', 'Signed up'];
const KEYS = ['view', 'start', 'chat1', 'chat5', 'end', 'cta', 'signup'] as const;
const steps = (ns: number[], from = 0) => ns.map((n, i) => ({ key: KEYS[i + from]!, label: LABELS[i + from]!, n, dropPct: i === 0 ? null : (ns[i - 1]! > 0 ? Math.round(((ns[i - 1]! - n) / ns[i - 1]!) * 100) : null) }));
const empty = (): GameWindow => ({
  steps: steps([0, 0, 0, 0, 0, 0, 0]),
  byIndustry: INDUSTRIES.map((industry) => ({ industry, steps: steps([0, 0, 0, 0, 0, 0], 1) })),
  wrongShare: [1, 2, 3, 4, 5].map((chat) => ({ chat, chats: 0, wrong: 0, pct: null })),
});
const ZERO: GameFunnel = { '7d': empty(), '30d': empty() };
const DATA: GameFunnel = {
  '7d': { ...empty(), steps: steps([100, 60, 50, 30, 30, 9, 3]), wrongShare: [{ chat: 1, chats: 50, wrong: 10, pct: 20 }, { chat: 2, chats: 45, wrong: 18, pct: 40 }, { chat: 3, chats: 40, wrong: 20, pct: 50 }, { chat: 4, chats: 35, wrong: 21, pct: 60 }, { chat: 5, chats: 30, wrong: 24, pct: 80 }] },
  '30d': { ...empty(), steps: steps([400, 240, 200, 120, 118, 30, 9]), byIndustry: INDUSTRIES.map((industry, i) => ({ industry, steps: steps(i === 0 ? [80, 70, 40, 40, 12, 4] : [0, 0, 0, 0, 0, 0], 1) })) },
};

describe('[P71-T] the Game funnel card', () => {
  it('renders with zero data: every step 0, no drop shown, no wrong-tap share yet', () => {
    render(<GameFunnelCard game={ZERO} />);
    const card = screen.getByTestId('game-funnel');
    expect(within(card).getByRole('heading', { name: 'Game funnel' })).toBeInTheDocument();
    for (const l of LABELS) expect(within(screen.getByTestId(`game-step-${l}`)).getByText('0')).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/NaN|Infinity|undefined/);
    expect(card.textContent).toContain('No chats finished in this period yet.');
  });
  it('shows counts and the % drop at each step, 7 days by default, 30 days on tap', async () => {
    render(<GameFunnelCard game={DATA} />);
    expect(within(screen.getByTestId('game-step-Picked an industry')).getByText('60')).toBeInTheDocument();
    expect(within(screen.getByTestId('game-step-Picked an industry')).getByText('−40%')).toBeInTheDocument();
    expect(within(screen.getByTestId('game-step-Tapped the CTA')).getByText('−70%')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '30 days' }));
    expect(within(screen.getByTestId('game-step-Saw the game')).getByText('400')).toBeInTheDocument();
  });
  it('splits by industry (from the start step) and shows the wrong-tap share per chat', async () => {
    render(<GameFunnelCard game={DATA} />);
    const wrong = screen.getByTestId('game-wrong');
    expect(within(wrong).getByText('Chat 5')).toBeInTheDocument();
    expect(within(wrong).getByText('80% (24 of 30)')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '30 days' }));
    const table = screen.getByTestId('game-by-industry');
    expect(within(table).getAllByRole('row')).toHaveLength(7); // header + 6 industries
    const property = within(table).getByRole('row', { name: /Property/ });
    expect(property.textContent).toContain('80');
    expect(property.textContent).toContain('4');
  });
});
