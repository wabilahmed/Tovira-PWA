import type { LedgerRepository, LedgerEventRecord } from '../../ports/ledger-repository.js';
import type { InventoryRepository } from '../../ports/inventory-repository.js';
import type { InventoryMatchRepository, MatchRecord } from '../../ports/inventory-match-repository.js';
import type { RequirementRepository } from '../../ports/requirement-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import { NO_RESTRICTION, type Restriction } from '../erasure/restriction.js';

/**
 * [P46-5] The Ledger: "the record of what Tovira helped you win". An entry exists ONLY where a stored link joins
 * something Tovira did to an outcome the rep marked: a share made from Tovira's suggestion, marked bought
 * (`inventory_suggested_bought`). A kept promise, a brief before a meeting and a re-engaged thread have no outcome the
 * rep marked, so they are not entries (they stay stored). Nothing here infers a credit.
 *  - what Tovira did: suggested this item, on the day it suggested it, with the client's words as the receipt (the
 *    exact suggestion when the share remembers it; for an older share, the one suggestion pairing this client and item,
 *    and no receipt when there is more than one: never a guess)
 *  - what happened: marked bought, and when
 *  - the deal value: entered by the rep on the entry, never estimated
 * A client under an erasure restriction is withheld.
 */
export interface LedgerEntry {
  id: string;
  clientId: string;
  clientName: string;
  itemTitle: string;
  suggestedAt: number;
  receipt: { quote: string; statedOn: string | null; noteId: string } | null;
  outcome: 'bought';
  outcomeAt: number;
  dealValueAed: number | null;
}

export interface LedgerEntryDeps {
  ledger: Pick<LedgerRepository, 'listByUser'>;
  inventory: Pick<InventoryRepository, 'findShareForUser' | 'findByIdForUser'>;
  matches: Pick<InventoryMatchRepository, 'findById' | 'listByClientItem'>;
  requirements: Pick<RequirementRepository, 'findByIdForUser'>;
  clients: Pick<ClientRepository, 'findByIdForUser'>;
  restriction?: { forUser(userId: string): Promise<Restriction> };
}

export async function ledgerEntries(userId: string, deps: LedgerEntryDeps): Promise<LedgerEntry[]> {
  const events = (await deps.ledger.listByUser(userId)).filter((e) => e.type === 'inventory_suggested_bought');
  const r = deps.restriction ? await deps.restriction.forUser(userId) : NO_RESTRICTION;
  const out: LedgerEntry[] = [];
  for (const e of events) {
    const entry = await toEntry(userId, e, deps, r);
    if (entry) out.push(entry);
  }
  return out.sort((a, b) => b.outcomeAt - a.outcomeAt);
}

async function toEntry(userId: string, e: LedgerEventRecord, deps: LedgerEntryDeps, r: Restriction): Promise<LedgerEntry | null> {
  const share = await deps.inventory.findShareForUser(userId, e.sourceId);
  if (!share || share.outcome !== 'bought' || share.outcomeSetBy !== 'confirmed_suggestion') return null; // no stored link → no entry
  const client = await deps.clients.findByIdForUser(userId, share.clientId);
  if (!client) return null;
  if (r.active && r.restrictsWho(client.name)) return null; // [TASK 2] erasure restriction
  const item = await deps.inventory.findByIdForUser(userId, share.itemId);
  let match: MatchRecord | null = share.matchId ? await deps.matches.findById(userId, share.matchId) : null;
  if (!match && !share.matchId) {
    const pairings = await deps.matches.listByClientItem(userId, share.clientId, share.itemId);
    match = pairings.length === 1 ? pairings[0]! : null; // exactly one: that is the suggestion; more than one: no guess
  }
  const req = match ? await deps.requirements.findByIdForUser(userId, match.requirementId) : null;
  const receipt = req && !(r.active && r.restrictsText(req.requirementRaw))
    ? { quote: req.requirementRaw, statedOn: req.statedOn, noteId: req.noteId }
    : null;
  return {
    id: e.id,
    clientId: client.id,
    clientName: client.name,
    itemTitle: item?.title ?? 'An item from your inventory',
    suggestedAt: match?.createdAt ?? share.sharedAt,
    receipt,
    outcome: 'bought',
    outcomeAt: e.occurredAt,
    dealValueAed: e.dealValueAed,
  };
}
