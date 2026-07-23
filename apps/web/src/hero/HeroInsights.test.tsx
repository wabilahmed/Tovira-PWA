import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroInsights, type HeroApi } from './HeroInsights.js';
import type { GateState, Pattern, RiskItem, TodayAction } from './heroClient.js';

function makeApi(over: Partial<{ status: GateState | null; today: TodayAction[]; patterns: Pattern[]; risk: RiskItem[] }> = {}): HeroApi {
  return {
    status: vi.fn().mockResolvedValue(over.status ?? { unlocked: true, counts: { clients: 5, notes: 20 }, needed: { clients: 0, notes: 0 }, message: '' }),
    today: vi.fn().mockResolvedValue(over.today ?? []),
    patterns: vi.fn().mockResolvedValue(over.patterns ?? []),
    risk: vi.fn().mockResolvedValue(over.risk ?? []),
  };
}

describe('<HeroInsights>', () => {
  it('always shows today actions (the always-on surface)', async () => {
    render(<HeroInsights api={makeApi({ today: [{ kind: 'promise', priority: 1, text: 'Chase the Acme quote', clientId: 'c1' }] })} />);
    expect(await screen.findByText(/chase the acme quote/i)).toBeInTheDocument();
  });

  it('shows an empty today state when there is nothing urgent', async () => {
    render(<HeroInsights api={makeApi({ today: [] })} />);
    expect(await screen.findByText(/nothing urgent/i)).toBeInTheDocument();
  });

  // Volume-gated: below threshold, an honest warming-up state that says what unlocks.
  it('shows the warming-up state with what unlocks it when locked', async () => {
    render(
      <HeroInsights
        api={makeApi({
          status: { unlocked: false, counts: { clients: 2, notes: 3 }, needed: { clients: 3, notes: 17 }, message: 'Keep feeding Tovira to unlock patterns.' },
          patterns: [],
          risk: [],
        })}
      />,
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/keep feeding tovira/i);
    expect(screen.getByText(/3 more client/i)).toBeInTheDocument();
    expect(screen.getByText(/17 more note/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pattern')).toBeNull();
  });

  // Unlocked: patterns cite their evidence; risks show why.
  it('renders patterns with evidence and risks with reasons when unlocked', async () => {
    render(
      <HeroInsights
        api={makeApi({
          status: { unlocked: true, counts: { clients: 6, notes: 30 }, needed: { clients: 0, notes: 0 }, message: '' },
          patterns: [{ id: 'p1', title: 'Deals stall after pricing', description: 'They go quiet once pricing lands.', confidence: 'tentative', evidence: [{ clientId: 'c1', name: 'Acme' }] }],
          risk: [{ clientId: 'c2', name: 'Meridian', reasons: ['silent 3 weeks', 'no decision-maker'] }],
        })}
      />,
    );
    expect(await screen.findByTestId('pattern')).toHaveTextContent(/deals stall after pricing/i);
    expect(screen.getByText(/evidence: acme/i)).toBeInTheDocument();
    expect(screen.getByTestId('risk')).toHaveTextContent(/meridian/i);
    expect(screen.getByText(/no decision-maker/i)).toBeInTheDocument();
  });

  it('shows a loading state first', () => {
    render(<HeroInsights api={makeApi()} />);
    expect(screen.getByText(/working out your day/i)).toBeInTheDocument();
  });
});
