/// <reference lib="webworker" />
/**
 * Tovira service worker (injectManifest). It does everything the old generated
 * worker did — precache the app shell, SPA navigation fallback, auto-update —
 * PLUS the piece that was missing: it receives the Android **share-target** POST
 * that the manifest advertises. WhatsApp's "Export chat → Share to Tovira" sends
 * the .txt here; a static PWA has no server to catch it, so the worker does:
 * it stashes the chat and redirects into the app, which imports it on load.
 */
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { readSharedChat, idbSharedChatStore } from './sharedChat.js';
import { resubscribeOnChange } from './resubscribe.js';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// The prerendered marketing routes (`/`, `/privacy`, `/terms`, `/ar` + Arabic
// legal). A stranger must never see a stale cached landing page after a deploy,
// so these are NETWORK-FIRST with a cached fallback for offline.
const MARKETING = /^\/(privacy|terms|ar(\/(privacy|terms))?)?$/;
const isMarketingNav = ({ request, url }: { request: Request; url: URL }): boolean =>
  request.mode === 'navigate' && MARKETING.test(url.pathname.replace(/\/$/, '') || '/');
registerRoute(isMarketingNav, new NetworkFirst({ cacheName: 'tovira-marketing' }));

// SPA: every OTHER navigation serves the app shell (app.html) — the marketing
// pages own `/`, so the shell moved off it. Never fire for the share-target POST,
// the marketing routes above, or `/api/*`: a browser navigation to an API URL must
// reach the network (CloudFront → ALB), not be answered with the cached app shell
// (which showed the login page for /api/* while curl, bypassing the worker, worked).
//
// NETWORK-FIRST (not cache-first precache): fetch the fresh app.html every online load — app.html is
// served no-cache, so this revalidates and a returning user gets the current shell + its new asset
// hashes without a cache clear. Offline (fetch throws) → fall back to the precached shell so the app
// still opens. A cache-first precache handler here was why a new deploy could stay invisible.
const appShellNav = async (): Promise<Response> => {
  try {
    const fresh = await fetch('/app.html', { cache: 'no-store' });
    if (fresh.ok) return fresh;
  } catch { /* offline — fall through to the precached shell */ }
  return (await matchPrecache('app.html')) ?? Response.error();
};
registerRoute(
  new NavigationRoute(appShellNav, { denylist: [/^\/api\//, /^\/share-target/, MARKETING] }),
);

// Update model: PROMPT, not auto. The app holds unsaved state (an in-progress voice recording /
// outbox), so a new worker must NOT silently skipWaiting + reload underneath the rep — that could
// interrupt a capture. Instead a new worker INSTALLS and WAITS; registerServiceWorker surfaces a
// "New version available — Reload" prompt, and only when the rep accepts does the page post
// SKIP_WAITING. On the first install (no existing controller) there is nothing to interrupt, so the
// worker activates normally and controls the page without a prompt.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  // Claim so that, once the rep accepts and we skipWaiting, the fresh worker controls immediately
  // (registerServiceWorker reloads once on the resulting controllerchange). The rep's data is in
  // IndexedDB (the outbox) + the server, which a worker swap and a reload never touch.
  event.waitUntil(self.clients.claim());
});

// Push (P3-6 / NUDGE-CONTENT): show the notification, and on tap open the deep link the
// server put in the payload (a pre-meeting nudge points at the client's brief, not home).
// Without these handlers a delivered push shows nothing and a tap goes nowhere.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; url?: string; tag?: string };
  try { payload = event.data.json() as typeof payload; } catch { payload = { body: event.data.text() }; }
  const { title = 'Tovira', body = '', url = '/app', tag } = payload;
  event.waitUntil(self.registration.showNotification(title, { body, data: { url }, ...(tag ? { tag } : {}) }));
});
// [P46-2] The browser replaced this device's subscription: store the new one so alerts keep arriving.
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & { newSubscription?: PushSubscription | null; waitUntil(p: Promise<unknown>): void };
  e.waitUntil(resubscribeOnChange({ fetchFn: (u, i) => fetch(u, i), pushManager: self.registration.pushManager, newSubscription: e.newSubscription ?? null }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/app';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      // Reuse an open tab where possible, navigating it to the deep link.
      await c.focus();
      if ('navigate' in c) { await (c as WindowClient).navigate(target).catch(() => undefined); }
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// The share-target handler the manifest advertises.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        try {
          const chat = await readSharedChat(await event.request.formData());
          if (chat) await idbSharedChatStore.put(chat);
        } catch {
          /* best effort — never block the redirect into the app */
        }
        return Response.redirect('/app?shared=chat', 303);
      })(),
    );
  }
});
