/**
 * Port: the per-rep inventory list (spec §3). Every method is scoped to a userId; the
 * Postgres implementation additionally enforces this at the DB via Row-Level Security,
 * and cross-tenant references are composite-FK violations (0041 + the 0036 IDOR doctrine).
 *
 * Share methods (inventory_shares) are added in feat(INV-SHARE).
 */

export type InventoryStatus = 'active' | 'disabled';
/** Why an item is off: sold through a confirmed purchase, or the rep took it down. */
export type InventoryDisabledReason = 'sold_out' | 'unlisted';

export interface InventoryItemRecord {
  id: string;
  userId: string;
  title: string;
  description: string;
  quantity: number;
  status: InventoryStatus;
  disabledReason: InventoryDisabledReason | null;
  /** Whether the item has an embedding stored (the vector itself never leaves the DB). */
  embedded: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface InventoryItemInput {
  title: string;
  description: string;
  quantity: number;
  /** Embedding of title + description, computed by the service; null if embedding failed. */
  embedding: number[] | null;
}

export interface InventoryItemPatch {
  title?: string;
  description?: string;
  quantity?: number;
  status?: InventoryStatus;
  disabledReason?: InventoryDisabledReason | null;
  embedding?: number[] | null;
}

export type ShareOutcome = 'pending' | 'bought' | 'declined' | 'no_response';
export type ShareSetBy = 'rep' | 'confirmed_suggestion';

export interface InventoryShareRecord {
  id: string;
  userId: string;
  itemId: string;
  clientId: string;
  sharedAt: number;
  outcome: ShareOutcome;
  /** Whether the rep set the outcome directly, or confirmed a Tovira suggestion (Batch 2). */
  outcomeSetBy: ShareSetBy | null;
  /** How many were bought — null until the outcome is `bought`. */
  quantityBought: number | null;
}

export interface ShareInput {
  itemId: string;
  clientId: string;
  outcomeSetBy?: ShareSetBy | null;
}
export interface ShareOutcomePatch {
  outcome: ShareOutcome;
  quantityBought?: number | null;
}

export interface InventoryRepository {
  create(userId: string, input: InventoryItemInput): Promise<InventoryItemRecord>;
  /** Newest first. `status` filters active/disabled; omitted returns all. */
  listByUser(userId: string, status?: InventoryStatus): Promise<InventoryItemRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<InventoryItemRecord | null>;
  /** Patch an item; returns the updated record, or null if it isn't the caller's. */
  update(userId: string, id: string, patch: InventoryItemPatch): Promise<InventoryItemRecord | null>;
  /** Delete every item for a user — account deletion only (nothing else deletes). */
  purgeUser(userId: string): Promise<void>;

  // ---- shares (feat(INV-SHARE)) ----
  createShare(userId: string, input: ShareInput): Promise<InventoryShareRecord>;
  /** All shares of an item, newest first (share history). */
  listSharesByItem(userId: string, itemId: string): Promise<InventoryShareRecord[]>;
  /** All shares to a client, newest first (client-detail inventory section). */
  listSharesByClient(userId: string, clientId: string): Promise<InventoryShareRecord[]>;
  findShareForUser(userId: string, shareId: string): Promise<InventoryShareRecord | null>;
  updateShareOutcome(userId: string, shareId: string, patch: ShareOutcomePatch): Promise<InventoryShareRecord | null>;
}
