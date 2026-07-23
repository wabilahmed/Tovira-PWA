import { describe, it, expect, vi } from 'vitest';
import { enablePush, urlBase64ToUint8Array, type EnablePushDeps } from './enablePush.js';

function deps(over: Partial<EnablePushDeps> = {}): EnablePushDeps {
  return {
    vapidPublicKey: 'BObcd_efghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_',
    requestPermission: vi.fn().mockResolvedValue('granted'),
    getRegistration: vi.fn().mockResolvedValue({
      pushManager: { subscribe: vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: 'https://push.test/x' }) }) },
    }),
    saveSubscription: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

describe('enablePush', () => {
  it('subscribes and saves when permission is granted → enabled', async () => {
    const d = deps();
    expect(await enablePush(d)).toBe('enabled');
    expect(d.saveSubscription).toHaveBeenCalledWith({ endpoint: 'https://push.test/x' });
  });

  // NEGATIVE: no VAPID key configured (e.g. before deploy) → unsupported, no calls.
  it('returns unsupported when no VAPID key is configured', async () => {
    const d = deps({ vapidPublicKey: '' });
    expect(await enablePush(d)).toBe('unsupported');
    expect(d.requestPermission).not.toHaveBeenCalled();
  });

  // NEGATIVE: permission denied → denied, never subscribes.
  it('returns denied when the rep blocks notifications', async () => {
    const sub = vi.fn();
    const d = deps({ requestPermission: vi.fn().mockResolvedValue('denied'), getRegistration: vi.fn().mockResolvedValue({ pushManager: { subscribe: sub } }) });
    expect(await enablePush(d)).toBe('denied');
    expect(sub).not.toHaveBeenCalled();
  });

  // NEGATIVE: no service worker / push manager (e.g. iOS not installed) → unsupported.
  it('returns unsupported when there is no push manager', async () => {
    expect(await enablePush(deps({ getRegistration: vi.fn().mockResolvedValue(null) }))).toBe('unsupported');
  });

  // NEGATIVE: a failing save → error.
  it('returns error when the subscription cannot be saved', async () => {
    expect(await enablePush(deps({ saveSubscription: vi.fn().mockResolvedValue(false) }))).toBe('error');
  });

  it('returns error when the browser throws during subscribe', async () => {
    const d = deps({ getRegistration: vi.fn().mockResolvedValue({ pushManager: { subscribe: vi.fn().mockRejectedValue(new Error('nope')) } }) });
    expect(await enablePush(d)).toBe('error');
  });

  it('decodes a base64url VAPID key to bytes', () => {
    const bytes = urlBase64ToUint8Array('AAAA');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(3);
  });
});
