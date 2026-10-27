import type { LedgerRepository } from '../../ports/ledger-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { InventoryRepository } from '../../ports/inventory-repository.js';

/** [P47-1] A Won counts only within this many days of the suggestion share (share time → the rep's Won). */
export const WON_WINDOW_DAYS = 60;
const DAY_MS = 86_400_000;

/**
 * [P47-1] "Won after a suggestion": when THE REP has set the client to Won (outcome 'won', source 'rep') within
 * WON_WINDOW_DAYS of a share made from a Tovira suggestion for that client, the Ledger holds ONE entry for that Won,
 * linked to the most recent such share. Run after every outcome change (set, undo, restore): it keeps the entry in
 * step with the client, so undoing Won removes it and setting Won again leaves one. Tovira never sets Won itself, and
 * nothing is inferred: both recorded events (the suggestion share and the rep's Won) are required.
 */
export async function syncWonEntry(
  deps: {
    ledger: Pick<LedgerRepository, 'listByUser' | 'record' | 'removeWhere'>;
    clients: Pick<ClientRepository, 'findByIdForUser'>;
    shares: Pick<InventoryRepository, 'listSharesByClient'>;
  },
  userId: string,
  clientId: string,
): Promise<void> {
  const client = await deps.clients.findByIdForUser(userId, clientId);
  let want: { shareId: string; wonAt: number } | null = null;
  if (client && client.outcome === 'won' && client.outcomeSource === 'rep' && client.outcomeChangedAt !== null) {
    const wonAt = client.outcomeChangedAt;
    const latest = (await deps.shares.listSharesByClient(userId, clientId))
      .filter((s) => s.outcomeSetBy === 'confirmed_suggestion' && s.sharedAt <= wonAt && wonAt - s.sharedAt <= WON_WINDOW_DAYS * DAY_MS)
      .sort((a, b) => b.sharedAt - a.sharedAt)[0];
    if (latest) want = { shareId: latest.id, wonAt };
  }
  const have = (await deps.ledger.listByUser(userId)).filter((e) => e.type === 'won_after_suggestion' && e.clientId === clientId);
  if (want && have.length === 1 && have[0]!.sourceId === want.shareId && have[0]!.occurredAt === want.wonAt) return; // in step
  if (have.length) await deps.ledger.removeWhere(userId, { clientId, type: 'won_after_suggestion' });
  if (want) {
    await deps.ledger.record(userId, { type: 'won_after_suggestion', clientId, sourceId: want.shareId, dedupeKey: `won:${clientId}:${want.wonAt}`, occurredAt: want.wonAt });
  }
}
