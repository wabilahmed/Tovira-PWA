import type { InventoryMatchRepository, MatchRecord, MatchConfidence } from '../../ports/inventory-match-repository.js';
import type { RequirementRepository, RequirementRecord } from '../../ports/requirement-repository.js';
import type { InventoryRepository, InventoryItemRecord } from '../../ports/inventory-repository.js';

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
    for (const { requirement, similarity } of reqs) {
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

  async dismiss(userId: string, matchId: string): Promise<void> {
    await this.matches.dismiss(userId, matchId);
  }

  /** Turn stored matches into surfaced suggestions, dropping any whose requirement is no longer open
   *  (dormant/met/gone) or whose item is no longer active (defense in depth over the creation-time
   *  filters), and any that would lack a receipt. No suggestion without the client's quoted words. */
  private async hydrate(userId: string, ms: MatchRecord[]): Promise<MatchSuggestion[]> {
    const out: MatchSuggestion[] = [];
    for (const m of ms) {
      const req = await this.requirements.findByIdForUser(userId, m.requirementId);
      if (!req || req.status !== 'open' || !req.requirementRaw) continue;
      const item = await this.inventory.findByIdForUser(userId, m.itemId);
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
