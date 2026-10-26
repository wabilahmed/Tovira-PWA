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
  // [P46-2 · owner] the test reports on this phone: { sent, thisDevice }
  sendTest: vi.fn().mockResolvedValue({ sent: 1, thisDevice: 'sent' }),
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
    // [P46-2 · owner] "Sent to this phone." replaces "Sent to N devices"
    expect(await screen.findByTestId('sent')).toHaveTextContent('Sent to this phone.');
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

// [P46-2] Owner (phone review): Settings said "Notifications are on" while the test reached 0 devices. The status is now
// the server's truth for THIS device, "Notifications are on" appears once, and the test reports on this phone.
describe('[P46-2] Notifications in Settings', () => {
  const api = (over: Partial<NotificationApi> = {}): NotificationApi => ({
    enable: vi.fn().mockResolvedValue('enabled'),
    status: vi.fn().mockResolvedValue('on'),
    sendTest: vi.fn().mockResolvedValue({ sent: 1, thisDevice: 'sent' }),
    ...over,
  });

  it('on for this phone: "Notifications are on for this phone." once, and nowhere else', async () => {
    const { container } = render(<NotificationSetup state={ready} api={api()} />);
    expect(await screen.findByText('Notifications are on for this phone.')).toBeInTheDocument();
    expect((container.textContent ?? '').match(/notifications are on/gi)).toHaveLength(1);
  });

  it('NEGATIVE: permission granted but this phone is not stored on the server → "not set up", never "on"', async () => {
    const a = api({ status: vi.fn().mockResolvedValueOnce('not_set_up').mockResolvedValue('on') });
    render(<NotificationSetup state={ready} api={a} />);
    expect(await screen.findByText('Notifications are not set up on this phone.')).toBeInTheDocument();
    expect(screen.queryByText(/notifications are on/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /send a test/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Set up on this phone' }));
    await waitFor(() => expect(a.enable).toHaveBeenCalled());
    expect(await screen.findByText('Notifications are on for this phone.')).toBeInTheDocument();
  });

  it('the test says "Sent to this phone."', async () => {
    render(<NotificationSetup state={ready} api={api()} />);
    await userEvent.click(await screen.findByRole('button', { name: /send a test/i }));
    expect(await screen.findByTestId('sent')).toHaveTextContent('Sent to this phone.');
  });

  it('NEGATIVE: the test finds this phone gone or not stored → a plain fix, and the status flips to "not set up"', async () => {
    render(<NotificationSetup state={ready} api={api({ sendTest: vi.fn().mockResolvedValue({ sent: 0, thisDevice: 'gone' }) })} />);
    await userEvent.click(await screen.findByRole('button', { name: /send a test/i }));
    expect(await screen.findByTestId('sent')).toHaveTextContent('This phone is not set up yet. Tap "Set up on this phone".');
    expect(screen.getByRole('button', { name: 'Set up on this phone' })).toBeInTheDocument();
  });

  it('NEGATIVE: the push service failed → says so with what to check', async () => {
    render(<NotificationSetup state={ready} api={api({ sendTest: vi.fn().mockResolvedValue({ sent: 0, thisDevice: 'failed' }) })} />);
    await userEvent.click(await screen.findByRole('button', { name: /send a test/i }));
    expect(await screen.findByTestId('sent')).toHaveTextContent(/could not reach this phone/i);
  });
});
