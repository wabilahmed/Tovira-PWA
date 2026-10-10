/**
 * Register the service worker that makes Tovira installable and offline-capable.
 *
 * Guarantees (P0-5):
 * - Graceful degradation: if service workers are unsupported OR registration
 *   fails, the app still loads — we never throw out of here.
 * - Fresh, not stale, but SAFE: a new worker installs and WAITS (sw.ts no longer
 *   auto-skipWaiting). When one is waiting we surface a "New version available —
 *   Reload" prompt (the app holds unsaved state — an in-progress voice note — so a
 *   silent auto-reload could interrupt a capture). Accepting posts SKIP_WAITING to
 *   the waiting worker; when it takes control we reload ONCE so the rep lands on the
 *   fresh build. First install (no existing controller) activates with no prompt.
 */

interface SwWorkerLike {
  state?: string;
  postMessage?(message: unknown): void;
  addEventListener?(type: string, listener: () => void): void;
}
interface SwRegistrationLike {
  waiting?: SwWorkerLike | null;
  installing?: SwWorkerLike | null;
  addEventListener?(type: string, listener: () => void): void;
}
interface ServiceWorkerLike {
  controller?: unknown;
  register(url: string): Promise<SwRegistrationLike>;
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
  /**
   * Called when a NEW worker is waiting to take over (an update, not the first install). `apply`
   * triggers the switch (posts SKIP_WAITING → the worker activates → controllerchange → one reload).
   * Default: dispatch a `tovira:sw-update` window event carrying `apply`, which the in-app banner
   * (App.tsx) listens for. Injectable so tests can assert the prompt without a real worker.
   */
  onUpdate?: (apply: () => void) => void;
}

/** The default prompt surface: a window event the app's update banner subscribes to. */
function defaultOnUpdate(apply: () => void): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tovira:sw-update', { detail: { apply } }));
  } catch { /* no window (SSR/tests) — nothing to notify */ }
}

export async function registerServiceWorker(
  url = '/sw.js',
  deps: RegisterDeps = {},
): Promise<unknown | null> {
  const nav =
    deps.navigator ?? (typeof navigator !== 'undefined' ? (navigator as NavigatorLike) : undefined);
  const sw = nav?.serviceWorker;
  if (!sw) return null; // unsupported → app still loads

  const onUpdate = deps.onUpdate ?? defaultOnUpdate;

  try {
    // Whether a worker already controls this page. On the FIRST install there is none, and the new
    // worker's clients.claim() fires a controllerchange (none → active) that must NOT reload — there is
    // no stale content to replace, and reloading mid-load destroys the page. Only an UPDATE swap (a
    // controller already existed) reloads.
    const hadController = Boolean(sw.controller);
    const registration = await sw.register(url);

    // Reload ONCE when a NEW worker takes control (after the rep accepts → SKIP_WAITING → activate).
    let reloaded = false;
    sw.addEventListener?.('controllerchange', () => {
      if (reloaded || !hadController) return; // skip the first-install claim
      reloaded = true;
      (deps.location ?? (typeof location !== 'undefined' ? location : undefined))?.reload();
    });

    // Surface a waiting worker as an update prompt. Only when a controller already exists — otherwise
    // this is the FIRST install (nothing to interrupt), which activates and controls without a prompt.
    const promptFor = (worker: SwWorkerLike | null | undefined): void => {
      if (!worker || !sw.controller) return;
      onUpdate(() => worker.postMessage?.({ type: 'SKIP_WAITING' }));
    };

    // Already waiting at register time (the update installed on a previous visit).
    promptFor(registration.waiting);

    // A new worker found during this session: prompt once it finishes installing.
    registration.addEventListener?.('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener?.('statechange', () => {
        if (installing.state === 'installed') promptFor(registration.waiting ?? installing);
      });
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
