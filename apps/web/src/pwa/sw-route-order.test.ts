// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * [P71-SW · owner] Returning visitors were stuck on the old landing page after a deploy. Workbox answers a request with
 * the FIRST registered route that matches, and precacheAndRoute() ran first: its route maps "/" to the precached
 * index.html (directoryIndex) and "/app" to app.html (cleanURLs), cache-first. So the network-first marketing route and
 * the network-first app shell route below it never ran for those URLs. Pinned here: the precache route is registered
 * LAST, the marketing pages and the app shell go to the network first, and the precached copy is only the offline
 * fallback.
 */
const order: string[] = [];
const routes: Array<{ match: (o: { request: { mode: string }; url: URL }) => boolean; handler: unknown }> = [];
vi.mock('workbox-precaching', () => ({
  precache: () => order.push('precache'),
  precacheAndRoute: () => order.push('precacheAndRoute'),
  addRoute: () => order.push('precacheRoute'),
  cleanupOutdatedCaches: () => undefined,
  matchPrecache: async () => undefined,
}));
vi.mock('workbox-routing', () => ({
  registerRoute: (match: unknown, handler: unknown) => {
    if (typeof match === 'function') { order.push('route'); routes.push({ match: match as never, handler }); }
    else { order.push('navigationRoute'); routes.push({ match: (o) => o.request.mode === 'navigate' && !/^\/(api|share-target)/.test(o.url.pathname), handler: match }); }
  },
  NavigationRoute: class { constructor(public handler: unknown, public opts: unknown) {} },
}));
vi.mock('workbox-strategies', () => ({ NetworkFirst: class { handle() { return Promise.resolve(new Response('net')); } } }));
vi.mock('./sharedChat.js', () => ({ readSharedChat: () => undefined, idbSharedChatStore: () => undefined }));
vi.mock('./resubscribe.js', () => ({ resubscribeOnChange: () => undefined }));

beforeAll(async () => {
  (globalThis as Record<string, unknown>).self = { __WB_MANIFEST: [], addEventListener: () => undefined, registration: {}, clients: { claim: () => undefined } };
  await import('./sw.js');
});

describe('[P71-SW] the network comes first for the pages a deploy changes', () => {
  it('the precache route is registered after every navigation route (so it can no longer answer "/" or "/app" first)', () => {
    expect(order).not.toContain('precacheAndRoute');
    expect(order).toContain('precache');
    expect(order.at(-1)).toBe('precacheRoute');
    expect(order.indexOf('precache')).toBeLessThan(order.indexOf('route'));
  });
  it('"/", "/privacy" and "/terms" navigations go to the network-first marketing route', () => {
    const first = (path: string) => routes.find((r) => r.match({ request: { mode: 'navigate' }, url: new URL('https://tovira.io' + path) }));
    for (const p of ['/', '/privacy', '/terms', '/privacy/']) expect(first(p), p).toBe(routes[0]);
    expect(first('/app')).toBe(routes[1]); // the app shell route, network-first
  });
});
