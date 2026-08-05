import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrialIncentive, type IncentiveApi } from './TrialIncentive.js';
import type { ExtensionIncentive } from './billingClient.js';

const NEW_END = Date.parse('2026-08-14T00:00:00Z');

function apiReturning(inc: ExtensionIncentive): IncentiveApi {
  return { incentive: vi.fn().mockResolvedValue(inc) };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('<TrialIncentive> (P5-1-UI)', () => {
  // UNEARNED-WITH-PROGRESS: shows how close they are, computed by the server.
  it('shows progress toward the +7-day extension', async () => {
    const api = apiReturning({ state: 'progress', distinctClients: 2, needed: 3, remaining: 1, extensionDays: 7, trialEndsAt: NEW_END });
    render(<TrialIncentive api={api} />);
    expect(await screen.findByTestId('incentive')).toHaveTextContent(/2 of 3/i);
    expect(screen.getByTestId('incentive')).toHaveTextContent(/one more/i);
    expect(screen.getByTestId('incentive')).toHaveTextContent(/\+7/);
  });

  // EARNED: celebrate with the new trial end date the SERVER reported.
  it('shows the earned state with the new trial end', async () => {
    const api = apiReturning({ state: 'earned', distinctClients: 3, needed: 3, remaining: 0, extensionDays: 7, trialEndsAt: NEW_END });
    render(<TrialIncentive api={api} />);
    expect(await screen.findByTestId('incentive-earned')).toHaveTextContent(/earned/i);
    expect(screen.getByTestId('incentive-earned')).toHaveTextContent(/aug 14, 2026|2026-08-14|14 aug/i);
  });

  // ALREADY-EXTENDED (hidden): once the one-time confirmation is dismissed it
  // stays hidden — the server still says "earned", the client just doesn't nag.
  it('hides the earned confirmation after it has been dismissed', async () => {
    const api = apiReturning({ state: 'earned', distinctClients: 3, needed: 3, remaining: 0, extensionDays: 7, trialEndsAt: NEW_END });
    window.localStorage.setItem('tovira.trialExtensionSeen', '1');
    const { container } = render(<TrialIncentive api={api} />);
    // Give the async status load a chance to resolve, then assert nothing rendered.
    await screen.findByTestId('incentive-probe');
    expect(container.querySelector('[data-testid="incentive-earned"]')).toBeNull();
  });

  // CONVERTED-TO-PAID (hidden): the widget renders nothing.
  it('renders nothing when the server reports hidden (paid / expired)', async () => {
    const api = apiReturning({ state: 'hidden', distinctClients: 0, needed: 3, remaining: 3, extensionDays: 7, trialEndsAt: 0 });
    render(<TrialIncentive api={api} />);
    await screen.findByTestId('incentive-probe');
    expect(screen.queryByTestId('incentive')).toBeNull();
    expect(screen.queryByTestId('incentive-earned')).toBeNull();
  });

  // The client never computes eligibility — it renders the server's verdict.
  it('reads its state from the server', async () => {
    const api = apiReturning({ state: 'progress', distinctClients: 1, needed: 3, remaining: 2, extensionDays: 7, trialEndsAt: NEW_END });
    render(<TrialIncentive api={api} />);
    await screen.findByTestId('incentive');
    expect(api.incentive).toHaveBeenCalledTimes(1);
  });
});
