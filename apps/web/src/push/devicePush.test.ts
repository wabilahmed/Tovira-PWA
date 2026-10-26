import { describe, it, expect, vi } from 'vitest';
import { ensureDevicePush, type DevicePushDeps, type SubscriptionLike } from './devicePush.js';
import { urlBase64ToUint8Array } from './enablePush.js';

/**
 * [P46-2] On app open (and in Settings) the app makes sure THIS device's push subscription exists and is stored on the
 * server: permission granted but no subscription → subscribe and store it; a subscription the server doesn't have →
 * store it; one made with an old VAPID key → replace it. It never prompts for permission on its own.
 */
const KEY = 'BObcd_efghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
const OLD = 'BOld_efghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_x';
const subFor = (endpoint: string, key = KEY): SubscriptionLike & { unsubscribe: ReturnType<typeof vi.fn> } => ({
  endpoint,
  options: { applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer },
  toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn().mockResolvedValue(true),
});

function deps(over: { existing?: SubscriptionLike | null; stored?: boolean | null; key?: string | null; permission?: NotificationPermission; standalone?: boolean; save?: boolean } = {}) {
  const fresh = subFor('https://push.test/new');
  const pushManager = { getSubscription: vi.fn().mockResolvedValue(over.existing ?? null), subscribe: vi.fn().mockResolvedValue(fresh) };
  const d: DevicePushDeps = {
    state: () => ({ standalone: over.standalone ?? true, notificationPermission: over.permission ?? 'granted', pushSupported: true }),
    getRegistration: vi.fn().mockResolvedValue({ pushManager }),
    api: {
      config: vi.fn().mockResolvedValue(over.key === undefined ? KEY : over.key),
      isStored: vi.fn().mockResolvedValue(over.stored ?? false),
      save: vi.fn().mockResolvedValue(over.save ?? true),
    },
  };
  return { d, pushManager, fresh };
}

describe('[P46-2] ensureDevicePush', () => {
  it('permission granted, no subscription on this device → subscribes with the server\'s key and stores it → on', async () => {
    const { d, pushManager } = deps({ existing: null });
    expect(await ensureDevicePush(d)).toEqual({ status: 'on', endpoint: 'https://push.test/new' });
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(d.api.save).toHaveBeenCalledWith({ endpoint: 'https://push.test/new', keys: { p256dh: 'p', auth: 'a' } });
  });

  it('a subscription the server already has → on, nothing re-sent', async () => {
    const { d, pushManager } = deps({ existing: subFor('https://push.test/here'), stored: true });
    expect(await ensureDevicePush(d)).toEqual({ status: 'on', endpoint: 'https://push.test/here' });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(d.api.save).not.toHaveBeenCalled();
  });

  it('a subscription the server lost (or deleted as gone) → stored again → on', async () => {
    const { d } = deps({ existing: subFor('https://push.test/here'), stored: false });
    expect((await ensureDevicePush(d)).status).toBe('on');
    expect(d.api.save).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://push.test/here' }));
  });

  it('a subscription made with an old VAPID key is replaced', async () => {
    const old = subFor('https://push.test/old', OLD);
    const { d, pushManager } = deps({ existing: old, stored: true });
    expect(await ensureDevicePush(d)).toEqual({ status: 'on', endpoint: 'https://push.test/new' });
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalled();
  });

  it('NEGATIVE: permission not yet asked → "ask", and it never prompts or subscribes on its own', async () => {
    const { d, pushManager } = deps({ permission: 'default' });
    expect((await ensureDevicePush(d)).status).toBe('ask');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('NEGATIVE: blocked → "blocked"; not installed → "install"; no key from the server → "unavailable"', async () => {
    expect((await ensureDevicePush(deps({ permission: 'denied' }).d)).status).toBe('blocked');
    expect((await ensureDevicePush(deps({ standalone: false }).d)).status).toBe('install');
    const nokey = deps({ key: '' });
    expect((await ensureDevicePush(nokey.d)).status).toBe('unavailable');
    expect(nokey.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('NEGATIVE: the server would not store it → "not_set_up", never "on"', async () => {
    expect((await ensureDevicePush(deps({ existing: null, save: false }).d)).status).toBe('not_set_up');
  });
});
