import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecallClient } from './recallClient.js';

/** [P39-7] "Add a note" posts the statement to /captures (held for To Confirm); the free-text ask() is gone. */
beforeEach(() => vi.unstubAllGlobals());

describe('RecallClient.create', () => {
  it('POSTs { clientId, statement } to /captures → held', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ capture: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new RecallClient('').create('c1', "Sara's budget is now 2.2M")).toBe('held');
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('/captures');
    expect(JSON.parse(String(init.body))).toEqual({ clientId: 'c1', statement: "Sara's budget is now 2.2M" });
  });

  it('402 → paused; anything else or a thrown request → failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 402 })));
    expect(await new RecallClient('').create('c1', 'x')).toBe('paused');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    expect(await new RecallClient('').create('c1', 'x')).toBe('failed');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await new RecallClient('').create('c1', 'x')).toBe('failed');
  });

  it('negative: there is no free-text ask any more', () => {
    expect((new RecallClient('') as unknown as { ask?: unknown }).ask).toBeUndefined();
  });
});
