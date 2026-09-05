import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroInsights, type HeroApi } from './HeroInsights.js';
import type { GateState, Pattern, RiskItem, TodayAction } from './heroClient.js';

function makeApi(over: Partial<{ status: GateState | null; today: TodayAction[]; patterns: Pattern[]; risk: RiskItem[]; refreshToday: HeroApi['refreshToday'] }> = {}): HeroApi {
  return {
    status: vi.fn().mockResolvedValue(over.status ?? { unlocked: true, counts: { clients: 5, notes: 20 }, needed: { clients: 0, notes: 0 }, message: '' }),
    today: vi.fn().mockResolvedValue(over.today ?? []),
    patterns: vi.fn().mockResolvedValue(over.patterns ?? []),
    risk: vi.fn().mockResolvedValue(over.risk ?? []),
    refreshToday: over.refreshToday ?? vi.fn().mockResolvedValue({ actions: [], refreshesRemaining: 1 }),
  };
}

describe('<HeroInsights>', () => {
  it('always shows today actions (the always-on surface)', async () => {
    render(<HeroInsights api={makeApi({ today: [{ kind: 'promise', priority: 1, text: 'Chase the Acme quote', clientId: 'c1' }] })} />);
    expect(await screen.findByText(/chase the acme quote/i)).toBeInTheDocument();
  });

  it('shows an empty today state when there is nothing urgent', async () => {
    render(<HeroInsights api={makeApi({ today: [] })} />);
    expect(await screen.findByText(/nothing on the register/i)).toBeInTheDocument();
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

  // [P4b-3] manual refresh updates the list and reports remaining refreshes.
  it('refreshes the list and shows the remaining count', async () => {
    const user = userEvent.setup();
    const refreshToday = vi.fn().mockResolvedValue({ actions: [{ kind: 'promise', priority: 1, text: 'Fresh action', clientId: 'c1' }], refreshesRemaining: 1 });
    render(<HeroInsights api={makeApi({ today: [], refreshToday })} />);
    await screen.findByText(/nothing on the register/i);
    await user.click(screen.getByRole('button', { name: /^refresh$/i }));
    expect(await screen.findByText(/fresh action/i)).toBeInTheDocument();
    expect(screen.getByTestId('refresh-msg')).toHaveTextContent(/1 refresh left today/i);
  });

  // The button reflects the rate-limit state (server-enforced).
  it('reflects the rate-limit state when refresh is blocked', async () => {
    const user = userEvent.setup();
    render(<HeroInsights api={makeApi({ refreshToday: vi.fn().mockResolvedValue('rate_limited') })} />);
    await screen.findByRole('button', { name: /^refresh$/i });
    await user.click(screen.getByRole('button', { name: /^refresh$/i }));
    expect(await screen.findByTestId('refresh-msg')).toHaveTextContent(/refresh limit reached/i);
    await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).toBeDisabled());
  });

  it('disables refresh when no refreshes remain', async () => {
    const user = userEvent.setup();
    render(<HeroInsights api={makeApi({ refreshToday: vi.fn().mockResolvedValue({ actions: [], refreshesRemaining: 0 }) })} />);
    await screen.findByRole('button', { name: /^refresh$/i });
    await user.click(screen.getByRole('button', { name: /^refresh$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^refresh$/i })).toBeDisabled());
  });

  // INV-MATCH: a match enters the register carrying its receipt (the client's quoted words + date)
  // in the subline, and is NOT counted as "need acting on" — a suggestion ranks below every fact.
  it('renders an inventory match row with its receipt, not flagged as needing action', async () => {
    render(<HeroInsights api={makeApi({ today: [
      { kind: 'match', priority: 0, text: 'Marina Heights 402 may suit Ahmed', clientId: 'c1', subline: 'asked: "a 2-bed near the marina" · 14 Mar 2026' },
    ] })} />);
    expect(await screen.findByText(/marina heights 402 may suit ahmed/i)).toBeInTheDocument();
    expect(screen.getByText(/a 2-bed near the marina/)).toBeInTheDocument();
    // One entry, and it is a suggestion — "need acting on" (cold/risk only) must stay absent.
    expect(screen.getByText(/^1 entry$/)).toBeInTheDocument();
    expect(screen.queryByText(/need acting on/i)).toBeNull();
    // No claret dot on a suggestion (claret is for overdue/cooling facts).
    expect(document.querySelector('.tov-dot--claret')).toBeNull();
  });
});
