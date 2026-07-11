import { describe, it, expect, vi } from 'vitest';
import { registerServiceWorker } from './registerServiceWorker.js';

function fakeNavigator(register: (url: string) => Promise<unknown>) {
  const listeners: Record<string, Array<() => void>> = {};
  const nav = {
    serviceWorker: {
      register,
      addEventListener: (ev: string, cb: () => void) => {
        (listeners[ev] ??= []).push(cb);
      },
    },
  };
  return { nav, fire: (ev: string) => (listeners[ev] ?? []).forEach((cb) => cb()) };
}

describe('registerServiceWorker', () => {
  it('is a no-op (returns null) when service workers are unsupported', async () => {
    const reg = await registerServiceWorker('/sw.js', { navigator: {} as never });
    expect(reg).toBeNull();
  });

  it('registers the service worker when supported', async () => {
    const register = vi.fn(async () => ({ scope: '/' }));
    const { nav } = fakeNavigator(register);
    const reg = await registerServiceWorker('/sw.js', { navigator: nav as never });
    expect(register).toHaveBeenCalledWith('/sw.js');
    expect(reg).not.toBeNull();
  });

  // NEGATIVE: "Service worker fails to register → app still loads."
  it('degrades gracefully when registration rejects (no throw, returns null)', async () => {
    const register = vi.fn(async () => {
      throw new Error('SW blocked');
    });
    const log = vi.fn();
    const { nav } = fakeNavigator(register);
    const reg = await registerServiceWorker('/sw.js', { navigator: nav as never, log });
    expect(reg).toBeNull();
    expect(log).toHaveBeenCalled();
  });

  // Update strategy: a new worker taking control reloads ONCE to serve the fresh
  // shell (returning users don't get a stale cache).
  it('reloads once when a new service worker takes control', async () => {
    const register = vi.fn(async () => ({ scope: '/' }));
    const reload = vi.fn();
    const { nav, fire } = fakeNavigator(register);
    await registerServiceWorker('/sw.js', { navigator: nav as never, location: { reload } });
    fire('controllerchange');
    fire('controllerchange'); // must not double-reload
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
