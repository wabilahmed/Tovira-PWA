import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StakeholderMap, type StakeholderApi } from './StakeholderMap.js';
import type { Stakeholder } from '../clients/clientsClient.js';

const person = (name: string, decision_role: string, extra: Partial<Stakeholder> = {}): Stakeholder => ({
  name, role: null, reports_to: null, decision_role, notes: null, ...extra,
});

const makeApi = (people: Stakeholder[]): StakeholderApi => ({ getStakeholders: vi.fn().mockResolvedValue(people) });

describe('<StakeholderMap>', () => {
  it('groups people by decision role, showing role and reporting line', async () => {
    render(
      <StakeholderMap
        clientId="c1"
        api={makeApi([
          person('Jordan', 'decision_maker', { role: 'VP' }),
          person('Sam', 'blocker', { reports_to: 'Jordan' }),
          person('Alex', 'influencer'),
        ])}
      />,
    );
    expect(await screen.findByTestId('group-decision_maker')).toHaveTextContent(/jordan, vp/i);
    expect(screen.getByTestId('group-blocker')).toHaveTextContent(/reports to jordan/i);
    expect(screen.getByTestId('group-influencer')).toHaveTextContent(/alex/i);
  });

  it('only renders groups that have people', async () => {
    render(<StakeholderMap clientId="c1" api={makeApi([person('Jordan', 'decision_maker')])} />);
    await screen.findByTestId('group-decision_maker');
    expect(screen.queryByTestId('group-blocker')).toBeNull();
  });

  it('shows an empty state when no stakeholders are captured', async () => {
    render(<StakeholderMap clientId="c1" api={makeApi([])} />);
    expect(await screen.findByText(/no stakeholders captured yet/i)).toBeInTheDocument();
  });

  it('shows a loading state first', () => {
    render(<StakeholderMap clientId="c1" api={makeApi([])} />);
    expect(screen.getByText(/loading stakeholders/i)).toBeInTheDocument();
  });
});
