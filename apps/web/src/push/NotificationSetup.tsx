import { useState } from 'react';
import { onboardingStep, type OnboardingState } from '../onboarding/onboarding.js';
import type { PushResult } from './enablePush.js';

export interface NotificationApi {
  enable(): Promise<PushResult>;
  sendTest(): Promise<number>;
}

const RESULT_MESSAGE: Record<PushResult, string> = {
  enabled: 'Notifications are on. 🎉',
  denied: 'Notifications are blocked — enable them in your browser settings, or rely on the in-app cold list.',
  unsupported: 'Notifications aren’t available here yet. On iPhone, add Tovira to your home screen first.',
  error: 'Something went wrong turning on notifications. Please try again.',
};

/** Enable Web Push (P3-6). Guides install-first on iOS, then enable; the in-app
 *  cold list is always the fallback, so this is never a silent dead feature. */
export function NotificationSetup({ state, api }: { state: OnboardingState; api: NotificationApi }): JSX.Element {
  const step = onboardingStep(state);
  const [result, setResult] = useState<PushResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);

  async function enable(): Promise<void> {
    setBusy(true);
    setSent(null);
    setResult(await api.enable());
    setBusy(false);
  }
  async function test(): Promise<void> {
    setSent(await api.sendTest());
  }

  const isOn = result === 'enabled' || step.stage === 'ready';

  return (
    <section aria-label="Notifications">
      <h2 style={{ marginTop: 0 }}>Notifications</h2>
      <p style={{ color: '#444' }}>{step.message}</p>

      {step.stage === 'enable' && !isOn && (
        <button onClick={() => void enable()} disabled={busy}>
          {busy ? 'Enabling…' : 'Enable notifications'}
        </button>
      )}

      {result && result !== 'enabled' && <p role="alert" style={{ color: '#92400e' }}>{RESULT_MESSAGE[result]}</p>}

      {isOn && (
        <div>
          <p style={{ color: 'green' }}>{RESULT_MESSAGE.enabled}</p>
          <button onClick={() => void test()}>Send a test notification</button>
          {sent !== null && <p data-testid="sent">Sent to {sent} device{sent === 1 ? '' : 's'}.</p>}
        </div>
      )}
    </section>
  );
}
