import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationSetup, type NotificationApi } from './NotificationSetup.js';
import type { OnboardingState } from '../onboarding/onboarding.js';

const installed: OnboardingState = { standalone: true, notificationPermission: 'default', pushSupported: true };
const notInstalled: OnboardingState = { standalone: false, notificationPermission: 'default', pushSupported: true };
const ready: OnboardingState = { standalone: true, notificationPermission: 'granted', pushSupported: true };

const makeApi = (over: Partial<NotificationApi> = {}): NotificationApi => ({
  enable: vi.fn().mockResolvedValue('enabled'),
  sendTest: vi.fn().mockResolvedValue(1),
  ...over,
});

describe('<NotificationSetup>', () => {
  // iOS install-first guidance: no enable button until the PWA is installed.
  it('shows install guidance and no enable button when not installed', () => {
    render(<NotificationSetup state={notInstalled} api={makeApi()} />);
    expect(screen.getByText(/add tovira to your home screen/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enable notifications/i })).toBeNull();
  });

  // POSITIVE: enabling succeeds → on state + test button.
  it('enables notifications and offers a test', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<NotificationSetup state={installed} api={api} />);
    await user.click(screen.getByRole('button', { name: /enable notifications/i }));
    await waitFor(() => expect(api.enable).toHaveBeenCalled());
    expect(await screen.findByText(/notifications are on/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /send a test/i }));
    expect(await screen.findByTestId('sent')).toHaveTextContent(/sent to 1 device/i);
  });

  // NEGATIVE: a denied permission shows the fallback guidance, stays off.
  it('shows the blocked message when the rep denies permission', async () => {
    const user = userEvent.setup();
    render(<NotificationSetup state={installed} api={makeApi({ enable: vi.fn().mockResolvedValue('denied') })} />);
    await user.click(screen.getByRole('button', { name: /enable notifications/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/blocked/i);
    expect(screen.queryByText(/notifications are on/i)).toBeNull();
  });

  // NEGATIVE: unsupported (no VAPID / no SW) → clear message, not a crash.
  it('shows an unsupported message', async () => {
    const user = userEvent.setup();
    render(<NotificationSetup state={installed} api={makeApi({ enable: vi.fn().mockResolvedValue('unsupported') })} />);
    await user.click(screen.getByRole('button', { name: /enable notifications/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/aren’t available here yet/i);
  });

  it('shows the already-on state with a test button when permission is granted', async () => {
    render(<NotificationSetup state={ready} api={makeApi()} />);
    expect(screen.getAllByText(/notifications are on/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /send a test/i })).toBeInTheDocument();
  });
});
