import { urlBase64ToUint8Array } from '../push/enablePush.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>;

/**
 * [P46-2] The service worker's `pushsubscriptionchange`: the browser replaced or dropped this device's subscription
 * (expiry, key rotation). Store the new one (or subscribe again with the server's key) so alerts keep arriving.
 * Never throws; returns whether a subscription was stored.
 */
export async function resubscribeOnChange({ fetchFn, pushManager, newSubscription }: {
  fetchFn: FetchLike;
  pushManager: { subscribe(o: { userVisibleOnly: boolean; applicationServerKey: BufferSource }): Promise<{ toJSON(): unknown }> };
  newSubscription: { toJSON(): unknown } | null;
}): Promise<boolean> {
  try {
    let sub = newSubscription;
    if (!sub) {
      const res = await fetchFn('/api/push/config', { credentials: 'include' });
      const key = res.ok && res.json ? ((await res.json()) as { vapidPublicKey?: string }).vapidPublicKey : '';
      if (!key) return false;
      sub = await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource });
    }
    const saved = await fetchFn('/api/push/subscribe', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()),
    });
    return saved.status === 201;
  } catch {
    return false;
  }
}
