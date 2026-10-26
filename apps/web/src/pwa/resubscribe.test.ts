import { describe, it, expect, vi } from 'vitest';
import { resubscribeOnChange } from './resubscribe.js';

// [P46-2] The browser can replace a push subscription on its own (expiry, key rotation): the service worker's
// `pushsubscriptionchange` subscribes again with the server's key and stores the new one, so alerts keep arriving.
describe('[P46-2] pushsubscriptionchange', () => {
  it('subscribes with the server\'s key and stores the new subscription', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ vapidPublicKey: 'BObcd_efgh' }) })
      .mockResolvedValueOnce({ ok: true, status: 201 });
    const subscribe = vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: 'https://push.test/n', keys: { p256dh: 'p', auth: 'a' } }) });
    expect(await resubscribeOnChange({ fetchFn, pushManager: { subscribe }, newSubscription: null })).toBe(true);
    expect(fetchFn).toHaveBeenNthCalledWith(1, '/api/push/config', expect.objectContaining({ credentials: 'include' }));
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/api/push/subscribe', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ endpoint: 'https://push.test/n', keys: { p256dh: 'p', auth: 'a' } }) }));
  });

  it('stores the browser\'s new subscription when the event already carries one', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    const subscribe = vi.fn();
    await resubscribeOnChange({ fetchFn, pushManager: { subscribe }, newSubscription: { toJSON: () => ({ endpoint: 'https://push.test/b' }) } });
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({ body: JSON.stringify({ endpoint: 'https://push.test/b' }) }));
  });

  it('NEGATIVE: no key from the server → nothing subscribed, returns false, never throws', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ vapidPublicKey: '' }) });
    const subscribe = vi.fn();
    expect(await resubscribeOnChange({ fetchFn, pushManager: { subscribe }, newSubscription: null })).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });
});
