import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryClient } from './inventoryClient.js';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sugg = { matchId: 'm1', itemId: 'i1', itemTitle: 'Marina Heights 402', clientId: 'c1', confidence: 'strong', receipt: { requirementRaw: 'looking for a 2-bed', statedOn: '2026-03-14', noteId: 'n1' } };

describe('InventoryClient — matches (INV-MATCH)', () => {
  const c = new InventoryClient('http://api.test');

  it('matches() gets the rep-wide suggestions + badge', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { suggestions: [sugg], badge: 3 }));
    const r = await c.matches();
    expect(r).toEqual({ suggestions: [sugg], badge: 3 });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/inventory/matches');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('matches(clientId) scopes to a client (the brief)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { suggestions: [sugg], badge: 0 }));
    await c.matches('c1');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/inventory/matches?clientId=c1');
  });

  it('itemMatches() gets the reverse direction', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { suggestions: [sugg] }));
    expect(await c.itemMatches('i1')).toEqual([sugg]);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/inventory/i1/matches');
  });

  it('dismissMatch posts to the dismiss endpoint', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await c.dismissMatch('m1')).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/inventory/matches/m1/dismiss');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
  });

  it('shareFromSuggestion posts to the suggestion-share endpoint', async () => {
    const share = { id: 's1', itemId: 'i1', clientId: 'c1', sharedAt: 1, outcome: 'pending', outcomeSetBy: 'confirmed_suggestion', quantityBought: null };
    fetchMock.mockResolvedValueOnce(json(200, { share, warning: null }));
    const r = await c.shareFromSuggestion('m1');
    expect(r?.share.outcomeSetBy).toBe('confirmed_suggestion');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/inventory/matches/m1/share');
  });

  it('markMatchesSeen posts to the seen endpoint (best-effort)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await c.markMatchesSeen();
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/inventory/matches/seen');
  });

  it('reads degrade to empty on a non-200', async () => {
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await c.matches()).toEqual({ suggestions: [], badge: 0 });
  });
});
