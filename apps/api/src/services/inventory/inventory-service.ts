import type { Embedder } from '../../ports/embedder.js';
import type { LedgerService } from '../ledger/ledger-service.js';
import type {
  InventoryRepository,
  InventoryItemRecord,
  InventoryStatus,
  InventoryShareRecord,
  ShareSetBy,
  ShareOutcome,
} from '../../ports/inventory-repository.js';

export type ShareResult =
  | { ok: true; share: InventoryShareRecord; warning: InventoryShareRecord[] | null }
  | { ok: false; reason: 'not_found' | 'disabled' };

export interface CreateItemInput {
  title: string;
  description: string;
  quantity: number;
}
export interface EditItemInput {
  title?: string;
  description?: string;
  quantity?: number;
}

/**
 * Inventory business logic. Embeds each item on save (title + description) via the EMBEDDER —
 * a Bedrock embeddings call, NOT a Claude call — so Batch 2's matching has data waiting.
 * Embedding is best-effort: a failure never blocks the save (the item is more important than
 * its vector; matching re-embeds later).
 *
 * Quantity ↔ status coupling (the arithmetic, rep-initiated, safe auto-disable — never
 * inference): editing quantity to 0 disables the item as `unlisted`; editing it back above 0
 * reactivates it, preserving its id, created date and (Batch 2) share history. The
 * sold-through path (→ `sold_out`) lives in the share lifecycle (feat(INV-SHARE)).
 */
export class InventoryService {
  constructor(
    private readonly repo: InventoryRepository,
    private readonly embedder: Embedder,
    private readonly ledger: LedgerService,
  ) {}

  async create(userId: string, input: CreateItemInput): Promise<InventoryItemRecord> {
    const embedding = await this.embed(input.title, input.description);
    return this.repo.create(userId, { title: input.title, description: input.description, quantity: input.quantity, embedding });
  }

  async edit(userId: string, id: string, patch: EditItemInput): Promise<InventoryItemRecord | null> {
    const existing = await this.repo.findByIdForUser(userId, id);
    if (!existing) return null;

    const repoPatch: Parameters<InventoryRepository['update']>[2] = {};
    if (patch.title !== undefined) repoPatch.title = patch.title;
    if (patch.description !== undefined) repoPatch.description = patch.description;
    if (patch.quantity !== undefined) repoPatch.quantity = patch.quantity;

    // Re-embed only when the matching surface (title/description) actually changed.
    if (patch.title !== undefined || patch.description !== undefined) {
      repoPatch.embedding = await this.embed(patch.title ?? existing.title, patch.description ?? existing.description);
    }

    // Arithmetic disable/reactivate — rep-initiated, never inferred.
    if (patch.quantity !== undefined) {
      if (patch.quantity <= 0 && existing.status === 'active') {
        repoPatch.status = 'disabled';
        repoPatch.disabledReason = 'unlisted';
      } else if (patch.quantity > 0 && existing.status === 'disabled') {
        repoPatch.status = 'active';
        repoPatch.disabledReason = null; // reactivation preserves id/created/history — same item returning
      }
    }
    return this.repo.update(userId, id, repoPatch);
  }

  list(userId: string, status?: InventoryStatus): Promise<InventoryItemRecord[]> {
    return this.repo.listByUser(userId, status);
  }

  get(userId: string, id: string): Promise<InventoryItemRecord | null> {
    return this.repo.findByIdForUser(userId, id);
  }

  sharesForItem(userId: string, itemId: string): Promise<InventoryShareRecord[]> {
    return this.repo.listSharesByItem(userId, itemId);
  }
  sharesForClient(userId: string, clientId: string): Promise<InventoryShareRecord[]> {
    return this.repo.listSharesByClient(userId, clientId);
  }

  /** Client-detail section: what has been shared with this client, with the item's title/status. */
  async sharesForClientDetailed(userId: string, clientId: string): Promise<Array<{ share: InventoryShareRecord; itemTitle: string; itemStatus: InventoryStatus }>> {
    const shares = await this.repo.listSharesByClient(userId, clientId);
    const out: Array<{ share: InventoryShareRecord; itemTitle: string; itemStatus: InventoryStatus }> = [];
    for (const share of shares) {
      const item = await this.repo.findByIdForUser(userId, share.itemId);
      out.push({ share, itemTitle: item?.title ?? '(removed)', itemStatus: item?.status ?? 'disabled' });
    }
    return out;
  }

  /**
   * Record a share (spec §11.2–3). Sharing NEVER reserves and never decrements — it only
   * logs intent, outcome `pending`. `warning` carries the prior pending shares when the item
   * is now over-shared (active pending shares meet or exceed quantity), so the rep sees
   * "already shared with …" — contextual, never blocking. The caller validates the client.
   */
  async share(userId: string, itemId: string, clientId: string, outcomeSetBy?: ShareSetBy): Promise<ShareResult> {
    const item = await this.repo.findByIdForUser(userId, itemId);
    if (!item) return { ok: false, reason: 'not_found' };
    if (item.status !== 'active') return { ok: false, reason: 'disabled' };
    const priorPending = (await this.repo.listSharesByItem(userId, itemId)).filter((s) => s.outcome === 'pending');
    const share = await this.repo.createShare(userId, { itemId, clientId, outcomeSetBy });
    // Warn only when re-sharing an already-committed item: there IS a prior pending share, and
    // this one takes the pending count to meet-or-exceed quantity. No warning on the first share.
    const warning = priorPending.length >= 1 && priorPending.length + 1 >= item.quantity ? priorPending : null;
    return { ok: true, share, warning };
  }

  /**
   * Set a share's outcome. On `bought` ONLY, decrement the item's quantity by the entered
   * amount (default 1); reaching 0 disables it as `sold_out` — the arithmetic auto-disable,
   * never inference. `declined`/`no_response`/`pending` never touch quantity.
   */
  async setOutcome(userId: string, shareId: string, outcome: ShareOutcome, quantityBought?: number): Promise<InventoryShareRecord | null> {
    const share = await this.repo.findShareForUser(userId, shareId);
    if (!share) return null;
    const bought = outcome === 'bought';
    const updated = await this.repo.updateShareOutcome(userId, shareId, { outcome, quantityBought: bought ? quantityBought ?? 1 : null });
    if (bought) {
      const item = await this.repo.findByIdForUser(userId, share.itemId);
      if (item) {
        const newQty = Math.max(0, item.quantity - (quantityBought ?? 1));
        const patch: Parameters<InventoryRepository['update']>[2] = { quantity: newQty };
        if (newQty === 0 && item.status === 'active') { patch.status = 'disabled'; patch.disabledReason = 'sold_out'; }
        await this.repo.update(userId, item.id, patch);
      }
      // Ledger credit (spec §11.5): ONLY when the rep acted on a Tovira suggestion — never a
      // share they made independently. Language stays "touched", no causal claim, no AED
      // unless the rep entered a deal value. Nothing sets confirmed_suggestion until Batch 2,
      // so this path is built + tested but dormant.
      if (share.outcomeSetBy === 'confirmed_suggestion') {
        await this.ledger.record(userId, {
          type: 'inventory_suggested_bought',
          clientId: share.clientId,
          sourceId: share.id,
          dedupeKey: `inventory_share:${share.id}`,
          occurredAt: Date.now(),
        });
      }
    }
    return updated;
  }

  /** Embed title + description; best-effort — null on failure, never throws. */
  private async embed(title: string, description: string): Promise<number[] | null> {
    try {
      return await this.embedder.embed(`${title}\n${description}`);
    } catch {
      return null;
    }
  }
}
