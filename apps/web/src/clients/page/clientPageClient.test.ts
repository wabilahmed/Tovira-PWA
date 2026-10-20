import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpClientPageClient, ago } from './clientPageClient.js';

afterEach(() => vi.unstubAllGlobals());

describe('[P36-5] the client page data client', () => {
  it('an unexpected overview body (older server, proxy page) is "no overview", never a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ clients: [] }), { status: 200 })));
    expect(await new HttpClientPageClient().overview('c1')).toBeNull();
  });

  it('"Last message …" reads in days / weeks / months', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(ago('2026-10-20T09:00', now)).toBe('today');
    expect(ago('2026-10-19T09:00', now)).toBe('yesterday');
    expect(ago('2026-10-17T09:00', now)).toBe('3 days ago');
    expect(ago('2026-09-20T09:00', now)).toBe('4 weeks ago');
  });
});
