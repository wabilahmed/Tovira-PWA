/// <reference lib="webworker" />
/**
 * Tovira service worker (injectManifest). It does everything the old generated
 * worker did — precache the app shell, SPA navigation fallback, auto-update —
 * PLUS the piece that was missing: it receives the Android **share-target** POST
 * that the manifest advertises. WhatsApp's "Export chat → Share to Tovira" sends
 * the .txt here; a static PWA has no server to catch it, so the worker does:
 * it stashes the chat and redirects into the app, which imports it on load.
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { readSharedChat, idbSharedChatStore } from './sharedChat.js';

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
// pages own `/`, so the shell moved off it. Never fire for the share-target POST
// or the marketing routes above.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('app.html'), { denylist: [/^\/share-target/, MARKETING] }),
);

// Auto-update: take over immediately so a returning user gets the fresh build
// (registerServiceWorker reloads once on controllerchange).
self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
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
