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
import { readSharedChat, idbSharedChatStore } from './sharedChat.js';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA: serve index.html for client-side routes (matches the old generateSW
// navigateFallback), but never for the share-target POST.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/share-target/] }),
);

// Auto-update: take over immediately so a returning user gets the fresh build
// (registerServiceWorker reloads once on controllerchange).
self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
        return Response.redirect('/?shared=chat', 303);
      })(),
    );
  }
});
