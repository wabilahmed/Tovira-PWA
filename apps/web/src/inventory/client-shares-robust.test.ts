import { describe, it, expect, vi, afterEach } from 'vitest';
import { InventoryClient } from './inventoryClient.js';

/** [P39-8] Found while screenshotting: a 200 without `shares` crashed the client page (ClientInventory read
 *  `shares.length` of undefined). A malformed body now reads as "no shares". */
afterEach(() => vi.unstubAllGlobals());

describe('[P39-8] sharesForClient never hands the page undefined', () => {
  it('a 200 with no shares array → []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    expect(await new InventoryClient('').sharesForClient('c1')).toEqual([]);
  });
  it('a thrown request → []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await new InventoryClient('').sharesForClient('c1')).toEqual([]);
  });
});
