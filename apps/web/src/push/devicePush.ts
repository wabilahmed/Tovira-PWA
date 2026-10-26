import { onboardingStep, type OnboardingState } from '../onboarding/onboarding.js';
import { urlBase64ToUint8Array } from './enablePush.js';

/**
 * [P46-2] This device's push status, from the SERVER's point of view. The browser permission alone said "on" while no
 * subscription was stored (the live build had no VAPID key and never subscribed), so no alert reached anyone.
 *  - on:          this device's subscription is stored on the server
 *  - not_set_up:  permission is granted but the server has no subscription for this device
 *  - ask:         permission not asked yet (never prompted from here; the rep taps a button)
 *  - blocked / install / unavailable: as they say
 */
export type DeviceStatus = 'on' | 'not_set_up' | 'ask' | 'blocked' | 'install' | 'unavailable';

export interface SubscriptionLike {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null };
  toJSON(): unknown;
  unsubscribe?(): Promise<boolean>;
}
export interface PushManagerLike {
  getSubscription(): Promise<SubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: BufferSource }): Promise<SubscriptionLike>;
}
export interface DevicePushDeps {
  state: () => OnboardingState;
  getRegistration: () => Promise<{ pushManager?: PushManagerLike } | null>;
  api: {
    /** The server's VAPID public key ('' or null when push is not configured there). */
    config(): Promise<string | null>;
    /** Whether the server has this endpoint for the signed-in rep (null = could not ask). */
    isStored(endpoint: string): Promise<boolean | null>;
    save(subscription: unknown): Promise<boolean>;
  };
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return true; // the browser does not expose it: assume it matches rather than churn the subscription
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * Make sure this device can receive pushes, without ever prompting: when permission is granted, subscribe if there is
 * no subscription (or it was made with an old key), and store it on the server when the server doesn't have it.
 */
export async function ensureDevicePush(deps: DevicePushDeps): Promise<{ status: DeviceStatus; endpoint: string | null }> {
  const stage = onboardingStep(deps.state()).stage;
  if (stage === 'install') return { status: 'install', endpoint: null };
  if (stage === 'blocked') return { status: 'blocked', endpoint: null };
  if (stage === 'enable') return { status: 'ask', endpoint: null };
  try {
    const key = await deps.api.config();
    if (!key) return { status: 'unavailable', endpoint: null };
    const pushManager = (await deps.getRegistration())?.pushManager;
    if (!pushManager) return { status: 'unavailable', endpoint: null };
    const keyBytes = urlBase64ToUint8Array(key);
    let sub = await pushManager.getSubscription();
    let fresh = false;
    if (sub && !sameKey(sub.options?.applicationServerKey, keyBytes)) {
      await sub.unsubscribe?.().catch(() => false);
      sub = null;
    }
    if (!sub) {
      sub = await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes as BufferSource });
      fresh = true;
    }
    const stored = fresh ? false : await deps.api.isStored(sub.endpoint);
    if (stored) return { status: 'on', endpoint: sub.endpoint };
    return (await deps.api.save(sub.toJSON())) ? { status: 'on', endpoint: sub.endpoint } : { status: 'not_set_up', endpoint: sub.endpoint };
  } catch {
    return { status: 'not_set_up', endpoint: null };
  }
}
