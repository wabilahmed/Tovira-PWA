import { hapticTick } from '../haptics.js';
import { useEffect, useState } from 'react';
import { onboardingStep, type OnboardingState } from '../onboarding/onboarding.js';
import type { PushResult } from './enablePush.js';
import type { DeviceStatus } from './devicePush.js';
import type { TestResult } from './pushClient.js';
import { Button } from '../ui/index.js';

export interface NotificationApi {
  enable(): Promise<PushResult>;
  /** [P46-2] The server's truth for THIS device (after a silent re-subscribe when permission is granted). */
  status?(): Promise<DeviceStatus>;
  sendTest(): Promise<TestResult>;
}

const RESULT_MESSAGE: Record<Exclude<PushResult, 'enabled'>, string> = {
  denied: 'Notifications are blocked. Turn them on in your browser settings, or rely on the in-app cold list.',
  unsupported: 'Notifications aren’t available here yet. On iPhone, add Tovira to your home screen first.',
  error: 'Something went wrong turning on notifications. Please try again.',
};

const TEST_MESSAGE: Record<TestResult['thisDevice'], string> = {
  sent: 'Sent to this phone.',
  gone: 'This phone is not set up yet. Tap "Set up on this phone".',
  not_set_up: 'This phone is not set up yet. Tap "Set up on this phone".',
  failed: 'Could not reach this phone. Check that notifications for Tovira are allowed in your phone’s settings, then try again.',
};

/**
 * Notifications in Settings (P3-6 → P46-2). Guides install-first on iOS, then enable. Once permission is granted the
 * status is the SERVER's truth for this device ("on for this phone" only when its subscription is stored), and the test
 * reports on this phone. The in-app cold list is always the fallback, so this is never a silent dead feature.
 */
export function NotificationSetup({ state, api }: { state: OnboardingState; api: NotificationApi }): JSX.Element {
  const step = onboardingStep(state);
  const [result, setResult] = useState<PushResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [test, setTest] = useState<TestResult['thisDevice'] | null>(null);

  const readStatus = async (): Promise<void> => setDevice(api.status ? await api.status() : 'on');
  useEffect(() => { if (step.stage === 'ready') void readStatus(); }, [step.stage]);

  async function enable(): Promise<void> {
    setBusy(true);
    setTest(null);
    const outcome = await api.enable();
    setResult(outcome);
    if (outcome === 'enabled') {
      hapticTick(); // notifications turned on — a commit
      await readStatus();
    }
    setBusy(false);
  }
  async function sendTest(): Promise<void> {
    const r = await api.sendTest();
    setTest(r.thisDevice);
    if (r.thisDevice === 'gone' || r.thisDevice === 'not_set_up') setDevice('not_set_up');
  }

  const asking = step.stage === 'enable' && device === null;
  return (
    // [P39-11] The Settings section carries the title; no second heading here.
    <section aria-label="Notifications" className="ui-stack ui-gap-3">
      {(step.stage === 'install' || step.stage === 'blocked' || asking) && <p className="ui-secondary">{step.message}</p>}
      {asking && <div><Button variant="primary" onClick={() => void enable()} loading={busy}>{busy ? 'Enabling…' : 'Enable notifications'}</Button></div>}
      {result && result !== 'enabled' && <p role="alert" className="ui-danger">{RESULT_MESSAGE[result]}</p>}

      {step.stage === 'ready' && device === null && <p className="ui-secondary">Checking this phone…</p>}
      {device === 'on' && (
        <>
          <p data-testid="device-status">Notifications are on for this phone.</p>
          <div><Button onClick={() => void sendTest()}>Send a test notification</Button></div>
        </>
      )}
      {device === 'not_set_up' && (
        <>
          <p data-testid="device-status">Notifications are not set up on this phone.</p>
          <div><Button variant="primary" onClick={() => void enable()} loading={busy}>Set up on this phone</Button></div>
        </>
      )}
      {device === 'unavailable' && <p className="ui-secondary">Notifications aren’t available right now. Please try again later.</p>}
      {test && <p data-testid="sent" role="status">{TEST_MESSAGE[test]}</p>}
    </section>
  );
}
