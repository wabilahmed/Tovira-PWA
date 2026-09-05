/**
 * Port: persisted requirement↔inventory matches (INV-MATCH, §7). A match is a suggestion, never an
 * action. Persisting it does two things: makes dismissal IDEMPOTENT (a dismissed pairing never
 * resurfaces, from either match direction — the unique key is (user_id, requirement_id, item_id)),
 * and retains the raw `similarity` so beta accept/dismiss data can later derive the threshold that
 * is a placeholder today. Tenant-isolated; RLS + composite FKs at the DB.
 */
export type MatchConfidence = 'strong' | 'possible';
export type MatchStatus = 'open' | 'dismissed';

export interface MatchRecord {
  id: string;
  userId: string;
  requirementId: string;
  itemId: string;
  clientId: string;
  /** Cosine at creation — RETAINED for calibration, NEVER surfaced as a number (§4/§10: words). */
  similarity: number;
  confidence: MatchConfidence;
  status: MatchStatus;
  createdAt: number;
  dismissedAt: number | null;
}

export interface MatchUpsert {
  requirementId: string;
  itemId: string;
  clientId: string;
  similarity: number;
  confidence: MatchConfidence;
}

export interface InventoryMatchRepository {
  /** Idempotent on (userId, requirementId, itemId): a DISMISSED pairing stays dismissed and is
   *  returned unchanged (never resurfaces, from either direction); an OPEN one has its score/
   *  confidence refreshed; a new one is created open. Returns the resulting record. */
  upsert(userId: string, m: MatchUpsert): Promise<MatchRecord>;
  findPairing(userId: string, requirementId: string, itemId: string): Promise<MatchRecord | null>;
  findById(userId: string, matchId: string): Promise<MatchRecord | null>;
  listOpenByClient(userId: string, clientId: string): Promise<MatchRecord[]>;
  listOpenByItem(userId: string, itemId: string): Promise<MatchRecord[]>;
  /** All open STRONG matches across the rep — Today's register + the badge (possibles never enter
   *  either). Newest first. */
  listOpenStrongByUser(userId: string): Promise<MatchRecord[]>;
  dismiss(userId: string, matchId: string): Promise<void>;
  /** Badge seen-tracking: one timestamp per rep. The badge counts strong open matches created after
   *  it; opening the Inventory tab bumps it. Null before the rep has ever viewed. */
  getBadgeViewedAt(userId: string): Promise<number | null>;
  setBadgeViewedAt(userId: string, at: number): Promise<void>;
  /** NOTE-MOVE: re-file the matches of moved requirements under the new client — the pairing +
   *  dismissal are preserved (the requirement's vector is unchanged), only the client attribution
   *  moves, which fixes BOTH the client- and item-side views (one row, two views). Returns count. */
  reassignByRequirements(userId: string, requirementIds: string[], toClientId: string): Promise<number>;
  /** IMPORT-UNDO: delete the matches of removed requirements. Returns count. */
  deleteByRequirements(userId: string, requirementIds: string[]): Promise<number>;
  purgeUser(userId: string): Promise<void>;
}
