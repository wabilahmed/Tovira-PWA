import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Alerts, type ProactiveApi } from './Alerts.js';
import type { ColdClient, Notification } from './proactiveClient.js';

const notif = (id: string, title: string): Notification => ({ id, type: 'going_cold', clientId: 'c1', title, body: 'No contact in 30 days.', read: false, createdAt: 1 });
const coldC = (id: string, name: string): ColdClient => ({ id, name, createdAt: 1, lastTouchedAt: Date.parse('2026-06-01') });

function makeApi(notifs: Notification[], cold: ColdClient[]): ProactiveApi {
  return {
    listNotifications: vi.fn().mockResolvedValue(notifs),
    listCold: vi.fn().mockResolvedValue(cold),
    runScan: vi.fn().mockResolvedValue(true),
  };
}

describe('<Alerts>', () => {
  it('renders alerts and the going-cold list', async () => {
    render(<Alerts api={makeApi([notif('n1', 'Meridian has gone quiet')], [coldC('c1', 'Meridian')])} />);
    expect(await screen.findByText(/meridian has gone quiet/i)).toBeInTheDocument();
    expect(screen.getByTestId('alert')).toHaveTextContent(/no contact in 30 days/i);
    expect(screen.getByTestId('cold-client')).toHaveTextContent(/meridian/i);
  });

  // [SCREENS §10] cooling entries carry the silent-days counter — a fact, in
  // claret mono, computed client-side from the last-contact date.
  it('shows the silent-days counter for a cooling client', async () => {
    const now = Date.parse('2026-06-22'); // 21 days after 2026-06-01
    render(<Alerts now={now} api={makeApi([], [coldC('c1', 'Falcon Group')])} />);
    expect(await screen.findByTestId('cold-client')).toHaveTextContent(/falcon group · silent 21 days/i);
  });

  it('shows one honest quiet state when nothing needs the rep', async () => {
    render(<Alerts api={makeApi([], [])} />);
    expect(await screen.findByText(/nothing needs you and no one has gone quiet/i)).toBeInTheDocument();
  });

  // POSITIVE: refresh re-runs the scan and reloads.
  it('re-runs the scan on refresh', async () => {
    const user = userEvent.setup();
    const api = makeApi([], []);
    render(<Alerts api={api} />);
    await screen.findByText(/nothing needs you/i);
    await user.click(screen.getByRole('button', { name: /rescan/i }));
    await waitFor(() => expect(api.runScan).toHaveBeenCalled());
    expect((api.listNotifications as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it('shows a loading state first', () => {
    render(<Alerts api={makeApi([], [])} />);
    expect(screen.getByText(/loading alerts/i)).toBeInTheDocument();
  });
});
