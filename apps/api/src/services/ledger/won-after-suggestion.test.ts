import { describe, it, expect } from 'vitest';
import { syncWonEntry, WON_WINDOW_DAYS } from './won-after-suggestion.js';
import { InMemoryLedgerRepository } from '../../adapters/ledger/in-memory-ledger-repository.js';
import type { InventoryShareRecord } from '../../ports/inventory-repository.js';
import type { ClientRecord } from '../../ports/client-repository.js';

/**
 * [P47-1] Owner: "Won after a suggestion" is an entry when THE REP sets a client to Won within 60 days of a share made
 * from a Tovira suggestion for that same client. The window runs from the share to the Won. Several shares in the
 * window: linked to the most recent, one entry per Won. Undoing Won removes the entry; set again, still one entry.
 */
const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T10:00:00Z');
const share = (id: string, at: number, by: 'confirmed_suggestion' | 'rep' = 'confirmed_suggestion'): InventoryShareRecord =>
  ({ id, userId: 'u', itemId: 'i1', clientId: 'c1', sharedAt: at, outcome: 'pending', outcomeSetBy: by, quantityBought: null, matchId: null });

function setup(shares: InventoryShareRecord[]) {
  const ledger = new InMemoryLedgerRepository();
  const client: Partial<ClientRecord> = { id: 'c1', userId: 'u', name: 'Sara', outcome: 'open', outcomeSource: null, outcomeChangedAt: null };
  const deps = {
    ledger,
    clients: { findByIdForUser: async () => client as ClientRecord },
    shares: { listSharesByClient: async () => shares },
  };
  const won = async (at: number, source: 'rep' | 'inferred' = 'rep') => { Object.assign(client, { outcome: 'won', outcomeSource: source, outcomeChangedAt: at }); await syncWonEntry(deps, 'u', 'c1'); };
  const open = async () => { Object.assign(client, { outcome: 'open', outcomeSource: null, outcomeChangedAt: null }); await syncWonEntry(deps, 'u', 'c1'); };
  const entries = async () => (await ledger.listByUser('u')).filter((e) => e.type === 'won_after_suggestion');
  return { won, open, entries };
}

describe('[P47-1] Won after a suggestion', () => {
  it('the window is 60 days', () => { expect(WON_WINDOW_DAYS).toBe(60); });

  it('Won inside 60 days of a suggestion share → one entry linked to that share, at the moment of the Won', async () => {
    const s = setup([share('s1', T0)]);
    await s.won(T0 + 60 * DAY);
    expect((await s.entries()).map((e) => [e.sourceId, e.clientId, e.occurredAt])).toEqual([['s1', 'c1', T0 + 60 * DAY]]);
  });

  it('NEGATIVE: Won on day 61 → no entry', async () => {
    const s = setup([share('s1', T0)]);
    await s.won(T0 + 61 * DAY);
    expect(await s.entries()).toEqual([]);
  });

  it('NEGATIVE: Won with no suggestion share (only a share the rep made) → no entry', async () => {
    const s = setup([share('s1', T0, 'rep')]);
    await s.won(T0 + DAY);
    expect(await s.entries()).toEqual([]);
  });

  it('NEGATIVE: a share AFTER the Won does not count; Tovira never sets Won (an inferred source makes no entry)', async () => {
    const s = setup([share('s1', T0 + 5 * DAY)]);
    await s.won(T0 + DAY);
    expect(await s.entries()).toEqual([]);
    const s2 = setup([share('s1', T0)]);
    await s2.won(T0 + DAY, 'inferred');
    expect(await s2.entries()).toEqual([]);
  });

  it('two shares in the window → linked to the latest, one entry', async () => {
    const s = setup([share('s2', T0 + 10 * DAY), share('s1', T0)]);
    await s.won(T0 + 20 * DAY);
    expect((await s.entries()).map((e) => e.sourceId)).toEqual(['s2']);
  });

  it('undoing Won removes the entry; set, undone, set again → still one entry', async () => {
    const s = setup([share('s1', T0)]);
    await s.won(T0 + DAY);
    await s.open();
    expect(await s.entries()).toEqual([]);
    await s.won(T0 + 2 * DAY);
    await s.won(T0 + 2 * DAY); // a repeat sync never doubles it
    expect((await s.entries()).map((e) => e.occurredAt)).toEqual([T0 + 2 * DAY]);
  });
});
