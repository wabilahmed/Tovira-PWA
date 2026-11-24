import { currentRequirements } from '../clients/requirement-summary.js';
import type { InventoryMatchRepository, MatchRecord, MatchConfidence } from '../../ports/inventory-match-repository.js';
import type { RequirementRepository, RequirementRecord } from '../../ports/requirement-repository.js';
import type { InventoryRepository, InventoryItemRecord } from '../../ports/inventory-repository.js';
import { listForClients } from '../notes/list-for-clients.js';

/**
 * [INV-MATCH, A4b] The requirement↔inventory matching engine. Pure RETRIEVAL — vector cosine, never
 * a model call per pairing (§9). A match is a SUGGESTION, never an action: this service creates no
 * share, disables no item, and never sets a purchase outcome (§10). Every surfaced suggestion carries
 * the client's own quoted words as a receipt (§10), and confidence is a WORD, never a number (§4).
 *
 * Precision over everything (§4): the thresholds are deliberately HIGH and biased to silence — a
 * missed match is invisible and costless; a wrong one is a rep pitching a property a client never
 * asked about, in person. They are PLACEHOLDERS awaiting beta accept/dismiss calibration; the raw
 * similarity is retained on each match so those guesses can later be derived.
 */
export interface MatchThresholds {
  strong: number;
  possible: number;
}

// PLACEHOLDERS — awaiting beta calibration. Quieter than a typical cut on purpose (owner ruling):
// with zero calibration data, guess in the direction where being wrong is cheap. Loosening later is
// a config change; the first bad in-meeting suggestion is a story a rep tells other reps.
export const MATCH_THRESHOLDS: MatchThresholds = { strong: 0.65, possible: 0.55 };

const CANDIDATE_LIMIT = 20; // top-N nearest to consider before the threshold filter

export interface MatchReceipt {
  requirementRaw: string;
  statedOn: string | null;
  noteId: string;
}

export interface MatchSuggestion {
  matchId: string;
  itemId: string;
  itemTitle: string;
  clientId: string;
  /** A WORD, never a percentage — the surface must not render a number the rep reads as precision. */
  confidence: MatchConfidence;
  receipt: MatchReceipt;
}

export class MatchingService {
  constructor(
    private readonly matches: InventoryMatchRepository,
    private readonly requirements: RequirementRepository,
    private readonly inventory: InventoryRepository,
    private readonly thresholds: MatchThresholds = MATCH_THRESHOLDS,
  ) {}

  private confidenceFor(similarity: number): MatchConfidence | null {
    if (similarity >= this.thresholds.strong) return 'strong';
    if (similarity >= this.thresholds.possible) return 'possible';
    return null; // below the possible floor → silence
  }

  /** Direction 1 — a new/updated requirement against existing stock. The caller passes the fresh
   *  requirement vector (from the embed it just did). A met/dormant requirement, or one with no
   *  vector, matches nothing. */
  async matchRequirement(userId: string, requirement: RequirementRecord, vector: number[] | null): Promise<MatchRecord[]> {
    if (requirement.status !== 'open' || vector === null) return [];
    if (await this.isReplaced(userId, requirement)) return []; // [P84-7] a later count replaced this need
    const items = await this.inventory.searchByEmbedding(userId, vector, CANDIDATE_LIMIT); // ACTIVE items only
    return this.persist(userId, requirement.id, requirement.clientId, items.map((h) => ({ itemId: h.item.id, similarity: h.similarity })));
  }

  /** Direction 2 — a new inventory item against existing OPEN requirements (arguably the more
   *  valuable direction, §7). The caller passes the fresh item vector. A disabled / out-of-stock
   *  item (or one with no vector) matches nothing. */
  async matchItem(userId: string, item: InventoryItemRecord, vector: number[] | null): Promise<MatchRecord[]> {
    if (item.status !== 'active' || vector === null) return [];
    const reqs = await this.requirements.searchByEmbedding(userId, vector, CANDIDATE_LIMIT); // OPEN requirements only
    const out: MatchRecord[] = [];
    const replaced = new Map<string, Set<string>>();
    for (const { requirement, similarity } of reqs) {
      if ((await this.replacedIds(userId, requirement.clientId, replaced)).has(requirement.id)) continue; // [P84-7]
      const confidence = this.confidenceFor(similarity);
      if (!confidence) continue;
      out.push(await this.matches.upsert(userId, { requirementId: requirement.id, itemId: item.id, clientId: requirement.clientId, similarity, confidence }));
    }
    return out;
  }

  private async persist(userId: string, requirementId: string, clientId: string, hits: Array<{ itemId: string; similarity: number }>): Promise<MatchRecord[]> {
    const out: MatchRecord[] = [];
    for (const { itemId, similarity } of hits) {
      const confidence = this.confidenceFor(similarity);
      if (!confidence) continue;
      // upsert is idempotent on (user, requirement, item): a DISMISSED pairing stays dismissed, so
      // it can never resurface — not from this direction, not from the other.
      out.push(await this.matches.upsert(userId, { requirementId, itemId, clientId, similarity, confidence }));
    }
    return out;
  }

  /** Open matches for a client, each with its receipt — for the pre-meeting brief. */
  async suggestionsForClient(userId: string, clientId: string): Promise<MatchSuggestion[]> {
    return this.hydrate(userId, await this.matches.listOpenByClient(userId, clientId));
  }

  /** Open matches for one item ("N clients asked for something like this") — the Inventory tab. */
  async suggestionsForItem(userId: string, itemId: string): Promise<MatchSuggestion[]> {
    return this.hydrate(userId, await this.matches.listOpenByItem(userId, itemId));
  }

  /** All the rep's STRONG suggestions (with receipts) — the data behind Today's register (§11.4:
   *  strong only enter the register; possibles never clutter it). */
  async suggestionsForUser(userId: string): Promise<MatchSuggestion[]> {
    return this.hydrate(userId, await this.matches.listOpenStrongByUser(userId));
  }

  /** Strong matches SURFACED on/after `sinceMs` that are still open — neither shared (a share
   *  dismisses the match) nor dismissed. The Monday "surfaced but not acted this week" review:
   *  merely SEEING a suggestion does not count as acting on it, so viewedAt is deliberately ignored. */
  async suggestionsSurfacedSince(userId: string, sinceMs: number): Promise<MatchSuggestion[]> {
    const recent = (await this.matches.listOpenStrongByUser(userId)).filter((m) => m.createdAt >= sinceMs);
    return this.hydrate(userId, recent);
  }

  /** The Inventory-tab badge: how many STRONG, OPEN matches the rep has not yet seen. Filters on
   *  strong+open BEFORE the seen comparison (a flood of possibles never lights it; a dismissed match
   *  never counts), and counts only matches that would actually surface (requirement open, item
   *  active) so the number never exceeds what the tab shows. */
  async badgeCount(userId: string): Promise<number> {
    const viewedAt = (await this.matches.getBadgeViewedAt(userId)) ?? 0;
    const unseen = (await this.matches.listOpenStrongByUser(userId)).filter((m) => m.createdAt > viewedAt);
    if (unseen.length === 0) return 0;
    return (await this.hydrate(userId, unseen)).length;
  }

  /** Opening the Inventory tab clears the badge (a later strong match relights it). */
  async markBadgeViewed(userId: string, at: number = Date.now()): Promise<void> {
    await this.matches.setBadgeViewedAt(userId, at);
  }

  async dismiss(userId: string, matchId: string): Promise<void> {
    await this.matches.dismiss(userId, matchId);
  }

  /** One match by id (for acting on a suggestion — share-from-suggestion). */
  getMatch(userId: string, matchId: string): Promise<MatchRecord | null> {
    return this.matches.findById(userId, matchId);
  }

  /** [P84-7 · owner] The ids of a client's open needs that a later count replaced ("at least 3 bedrooms", then "4
   *  bedrooms not 3"): never matched, never suggested. Cached per call in `cache`. */
  private async replacedIds(userId: string, clientId: string, cache: Map<string, Set<string>>): Promise<Set<string>> {
    const hit = cache.get(clientId);
    if (hit) return hit;
    const out = replacedAmong(await this.requirements.listByClient(userId, clientId));
    cache.set(clientId, out);
    return out;
  }

  private async isReplaced(userId: string, requirement: RequirementRecord): Promise<boolean> {
    return (await this.replacedIds(userId, requirement.clientId, new Map())).has(requirement.id);
  }

  /** Turn stored matches into surfaced suggestions, dropping any whose requirement is no longer open
   *  (dormant/met/gone) or whose item is no longer active (defense in depth over the creation-time
   *  filters), and any that would lack a receipt. No suggestion without the client's quoted words. */
  private async hydrate(userId: string, ms: MatchRecord[]): Promise<MatchSuggestion[]> {
    const out: MatchSuggestion[] = [];
    if (ms.length === 0) return out;
    // [P86] the matches' requirements and items in one read each (was two reads per match). listOpenByUser is the
    // same (restricted) view findByIdForUser read from, already narrowed to the open needs a suggestion requires;
    // listByUser(active) is the active items a suggestion requires.
    const openReqs = new Map((await this.requirements.listOpenByUser(userId)).map((r) => [r.id, r]));
    const activeItems = new Map((await this.inventory.listByUser(userId, 'active')).map((i) => [i.id, i]));
    const replaced = new Map<string, Set<string>>();
    const clientIds = new Set(ms.map((m) => openReqs.get(m.requirementId)?.clientId).filter((id): id is string => !!id));
    const byClient = await listForClients(this.requirements, userId, clientIds);
    for (const id of clientIds) replaced.set(id, replacedAmong(byClient.get(id) ?? []));
    for (const m of ms) {
      const req = openReqs.get(m.requirementId);
      if (!req || req.status !== 'open' || !req.requirementRaw) continue;
      // [P84-7] a match made before a later count replaced its need is no longer suggested (kept, not deleted)
      if ((await this.replacedIds(userId, req.clientId, replaced)).has(req.id)) continue;
      const item = activeItems.get(m.itemId);
      if (!item || item.status !== 'active') continue;
      out.push({
        matchId: m.id,
        itemId: item.id,
        itemTitle: item.title,
        clientId: m.clientId,
        confidence: m.confidence,
        receipt: { requirementRaw: req.requirementRaw, statedOn: req.statedOn, noteId: req.noteId },
      });
    }
    return out;
  }
}

/** [P84-7] Of a client's needs, the ids of the OPEN ones a later count replaced (never matched, never suggested). */
function replacedAmong(reqs: RequirementRecord[]): Set<string> {
  const open = reqs.filter((r) => r.status === 'open');
  const current = new Set(currentRequirements(open).map((r) => r.id));
  return new Set(open.filter((r) => !current.has(r.id)).map((r) => r.id));
}
