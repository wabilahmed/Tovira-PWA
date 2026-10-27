import type { LedgerRepository, LedgerEventRecord } from '../../ports/ledger-repository.js';
import type { InventoryRepository, InventoryShareRecord } from '../../ports/inventory-repository.js';
import type { InventoryMatchRepository, MatchRecord } from '../../ports/inventory-match-repository.js';
import type { RequirementRepository } from '../../ports/requirement-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import { NO_RESTRICTION, type Restriction } from '../erasure/restriction.js';
import { WON_WINDOW_DAYS } from './won-after-suggestion.js';

/**
 * [P47-3 · owner] The Ledger shows only what Tovira helped the rep WIN. An entry comes from exactly one of these, each
 * needing two recorded events on the same client (Tovira's action and an outcome the rep marked), never inferred:
 *  - inventory_suggested_bought: a share made from Tovira's suggestion, marked bought
 *  - won_after_suggestion:       the rep set the client Won within 60 days of such a share
 *  - reengaged_after_alert:      the client's first message within 7 days after a going-quiet alert reached the rep
 * Kept promises, briefs before meetings and re-engaged threads stay stored and are shown nowhere.
 */
export const LEDGER_ENTRY_KINDS: ReadonlySet<string> = new Set(['inventory_suggested_bought', 'won_after_suggestion', 'reengaged_after_alert']);

/**
 * [P46-5 → P47-1] One deal Tovira helped with: what Tovira suggested (with the client's words), then what the rep
 * marked: bought, Won, or both (a suggestion marked bought and a Won for the same client within the window is ONE
 * card). Restricted clients are withheld.
 */
export interface LedgerEntry {
  id: string;
  clientId: string;
  clientName: string;
  itemTitle: string;
  suggestedAt: number;
  receipt: { quote: string; statedOn: string | null; noteId: string } | null;
  outcome: 'bought' | 'won' | 'bought_won';
  /** When the rep marked the suggestion bought, or null. */
  boughtAt: number | null;
  /** [P47-1] When the rep set the client Won, or null. */
  wonAt: number | null;
  /** The latest of the two (the period picker and the order use it). */
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

interface Suggestion { share: InventoryShareRecord; clientName: string; itemTitle: string; suggestedAt: number; receipt: LedgerEntry['receipt'] }

export async function ledgerEntries(userId: string, deps: LedgerEntryDeps): Promise<LedgerEntry[]> {
  const events = (await deps.ledger.listByUser(userId)).filter((e) => LEDGER_ENTRY_KINDS.has(e.type));
  const r = deps.restriction ? await deps.restriction.forUser(userId) : NO_RESTRICTION;
  const cards: Array<{ card: LedgerEntry; boughtShare: InventoryShareRecord | null }> = [];
  const base = (e: LedgerEventRecord, s: Suggestion) => ({ id: e.id, clientId: s.share.clientId, clientName: s.clientName, itemTitle: s.itemTitle, suggestedAt: s.suggestedAt, receipt: s.receipt, dealValueAed: e.dealValueAed });
  for (const e of events.filter((x) => x.type === 'inventory_suggested_bought')) {
    const s = await suggestion(userId, e.sourceId, deps, r, true);
    if (s) cards.push({ card: { ...base(e, s), outcome: 'bought', boughtAt: e.occurredAt, wonAt: null, outcomeAt: e.occurredAt }, boughtShare: s.share });
  }
  for (const e of events.filter((x) => x.type === 'won_after_suggestion')) {
    const s = await suggestion(userId, e.sourceId, deps, r, false);
    if (!s) continue;
    // [P47-1] A suggestion marked bought and a Won for the same client within the window: ONE card with both facts
    // (the same share first; else the latest bought suggestion for that client inside the window).
    const windowStart = e.occurredAt - WON_WINDOW_DAYS * 86_400_000;
    const candidates = cards.filter((c) => c.boughtShare && c.card.wonAt === null && c.boughtShare.clientId === s.share.clientId
      && c.boughtShare.sharedAt >= windowStart && c.boughtShare.sharedAt <= e.occurredAt);
    const into = candidates.find((c) => c.boughtShare!.id === s.share.id) ?? candidates.sort((a, b) => b.boughtShare!.sharedAt - a.boughtShare!.sharedAt)[0];
    if (into) {
      into.card.outcome = 'bought_won';
      into.card.wonAt = e.occurredAt;
      into.card.outcomeAt = Math.max(into.card.outcomeAt, e.occurredAt);
      continue;
    }
    cards.push({ card: { ...base(e, s), outcome: 'won', boughtAt: null, wonAt: e.occurredAt, outcomeAt: e.occurredAt }, boughtShare: null });
  }
  return cards.map((c) => c.card).sort((a, b) => b.outcomeAt - a.outcomeAt);
}

async function suggestion(userId: string, shareId: string, deps: LedgerEntryDeps, r: Restriction, mustBeBought: boolean): Promise<Suggestion | null> {
  const share = await deps.inventory.findShareForUser(userId, shareId);
  if (!share || share.outcomeSetBy !== 'confirmed_suggestion') return null; // no stored link → no entry
  if (mustBeBought && share.outcome !== 'bought') return null;
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
  const receipt = req && !(r.active && r.restrictsText(req.requirementRaw)) ? { quote: req.requirementRaw, statedOn: req.statedOn, noteId: req.noteId } : null;
  return { share, clientName: client.name, itemTitle: item?.title ?? 'An item from your inventory', suggestedAt: match?.createdAt ?? share.sharedAt, receipt };
}
