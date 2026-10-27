import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * [P47] The erasure guard sweeps every API route; a renderer can only show person-derived text the API returned, as
 * long as nothing on the device keeps an API response. Pinned: the service worker caches the marketing pages and the
 * app shell only, never an /api response (a cached response would keep showing a person after a restriction opened).
 */
const sw = readFileSync(fileURLToPath(new URL('./sw.ts', import.meta.url)), 'utf8');

describe('[P47] no API response is cached on the device', () => {
  it('NEGATIVE: no runtime caching strategy for /api, and /api is denied to the app-shell route', () => {
    expect(sw).not.toMatch(/CacheFirst|StaleWhileRevalidate|CacheOnly/);
    // a route that is not the app shell (which DENIES /api) must not match /api
    const routes = [...sw.matchAll(/registerRoute\(([\s\S]*?)\);/g)].map((m) => m[1]!);
    for (const r of routes.filter((x) => !x.includes('denylist'))) expect(r).not.toMatch(/api/i);
    expect(sw).toMatch(/denylist: \[\/\^\\\/api\\\/\//);
  });
});
