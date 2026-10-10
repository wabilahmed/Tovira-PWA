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
  it('reloads once when a new service worker takes control (an UPDATE swap — a controller existed)', async () => {
    const register = vi.fn(async () => ({ scope: '/' }));
    const reload = vi.fn();
    const { nav, fire } = fakeNavigator(register);
    (nav.serviceWorker as { controller?: unknown }).controller = {}; // a worker already controls = update
    await registerServiceWorker('/sw.js', { navigator: nav as never, location: { reload } });
    fire('controllerchange');
    fire('controllerchange'); // must not double-reload
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // First-install claim fires a controllerchange (none → active) that must NOT reload the page — there
  // is no stale build to replace, and reloading mid-load destroys it (this broke the PWA e2e).
  it('does NOT reload on the first-install controllerchange (no prior controller)', async () => {
    const register = vi.fn(async () => ({ scope: '/' }));
    const reload = vi.fn();
    const { nav, fire } = fakeNavigator(register); // no controller set
    await registerServiceWorker('/sw.js', { navigator: nav as never, location: { reload } });
    fire('controllerchange');
    expect(reload).not.toHaveBeenCalled();
  });

  // [SW-UPDATE] An update already waiting at register time (a controller exists = not first install)
  // must PROMPT, not auto-reload. Accepting posts SKIP_WAITING to the waiting worker; the reload only
  // happens later, on controllerchange — so a rep mid-capture is never reloaded underneath.
  it('prompts (does not reload) when an updated worker is waiting; applying posts SKIP_WAITING', async () => {
    const waiting = { postMessage: vi.fn() };
    const register = vi.fn(async () => ({ waiting, addEventListener: () => {} }));
    const reload = vi.fn();
    const onUpdate = vi.fn();
    const nav = { serviceWorker: { controller: {}, register, addEventListener: () => {} } };
    await registerServiceWorker('/sw.js', { navigator: nav as never, location: { reload }, onUpdate });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();         // no silent reload
    expect(waiting.postMessage).not.toHaveBeenCalled();
    (onUpdate.mock.calls[0]![0] as () => void)();  // the rep clicks "Reload"
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  // First install (no existing controller) must NOT prompt — there is no old build to replace and
  // nothing to interrupt; the worker just activates.
  it('does not prompt on first install (no existing controller)', async () => {
    const waiting = { postMessage: vi.fn() };
    const register = vi.fn(async () => ({ waiting, addEventListener: () => {} }));
    const onUpdate = vi.fn();
    const nav = { serviceWorker: { controller: undefined, register, addEventListener: () => {} } };
    await registerServiceWorker('/sw.js', { navigator: nav as never, onUpdate });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
