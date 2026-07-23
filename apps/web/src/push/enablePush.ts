/**
 * Turn on Web Push (P3-6): request permission, subscribe via the service worker's
 * push manager with the VAPID key, and persist the subscription. All browser bits
 * are injected so the flow is unit-testable without a real device — the real
 * on-device verification is a Phase-6 device task.
 */

export type PushResult = 'enabled' | 'denied' | 'unsupported' | 'error';

export interface PushRegistrationLike {
  pushManager?: {
    subscribe(options: { userVisibleOnly: boolean; applicationServerKey: BufferSource }): Promise<{ toJSON(): unknown }>;
  };
}

export interface EnablePushDeps {
  vapidPublicKey: string;
  requestPermission: () => Promise<NotificationPermission>;
  getRegistration: () => Promise<PushRegistrationLike | null>;
  saveSubscription: (subscription: unknown) => Promise<boolean>;
}

/** Base64URL VAPID key → Uint8Array for applicationServerKey. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(deps: EnablePushDeps): Promise<PushResult> {
  if (!deps.vapidPublicKey) return 'unsupported';
  try {
    const permission = await deps.requestPermission();
    if (permission !== 'granted') return 'denied';

    const registration = await deps.getRegistration();
    if (!registration?.pushManager) return 'unsupported';

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(deps.vapidPublicKey) as BufferSource,
    });

    return (await deps.saveSubscription(subscription.toJSON())) ? 'enabled' : 'error';
  } catch {
    return 'error';
  }
}
