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

  it('shows empty states for both sections', async () => {
    render(<Alerts api={makeApi([], [])} />);
    expect(await screen.findByText(/no alerts right now/i)).toBeInTheDocument();
    expect(screen.getByText(/no clients have gone cold/i)).toBeInTheDocument();
  });

  // POSITIVE: refresh re-runs the scan and reloads.
  it('re-runs the scan on refresh', async () => {
    const user = userEvent.setup();
    const api = makeApi([], []);
    render(<Alerts api={api} />);
    await screen.findByText(/no alerts right now/i);
    await user.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(api.runScan).toHaveBeenCalled());
    expect((api.listNotifications as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it('shows a loading state first', () => {
    render(<Alerts api={makeApi([], [])} />);
    expect(screen.getByText(/loading alerts/i)).toBeInTheDocument();
  });
});
