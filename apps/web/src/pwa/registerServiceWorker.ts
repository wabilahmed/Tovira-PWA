/**
 * Register the service worker that makes Tovira installable and offline-capable.
 *
 * Guarantees (P0-5):
 * - Graceful degradation: if service workers are unsupported OR registration
 *   fails, the app still loads — we never throw out of here.
 * - Fresh, not stale: the SW auto-updates (skipWaiting + clients.claim via
 *   vite-plugin-pwa); when a new worker takes control we reload ONCE so a
 *   returning user sees the new build, not a cached old shell.
 */

interface ServiceWorkerLike {
  register(url: string): Promise<unknown>;
  addEventListener?(type: string, listener: () => void): void;
}
interface NavigatorLike {
  serviceWorker?: ServiceWorkerLike;
}
interface LocationLike {
  reload(): void;
}

export interface RegisterDeps {
  navigator?: NavigatorLike;
  location?: LocationLike;
  log?: (message: string, error?: unknown) => void;
}

export async function registerServiceWorker(
  url = '/sw.js',
  deps: RegisterDeps = {},
): Promise<unknown | null> {
  const nav =
    deps.navigator ?? (typeof navigator !== 'undefined' ? (navigator as NavigatorLike) : undefined);
  const sw = nav?.serviceWorker;
  if (!sw) return null; // unsupported → app still loads

  try {
    const registration = await sw.register(url);

    let reloaded = false;
    sw.addEventListener?.('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      (deps.location ?? (typeof location !== 'undefined' ? location : undefined))?.reload();
    });

    return registration;
  } catch (error) {
    (deps.log ?? ((m: string, e?: unknown) => console.warn(m, e)))(
      'Service worker registration failed; continuing without offline support',
      error,
    );
    return null; // graceful degradation
  }
}
