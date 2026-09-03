import type { Embedder } from '../../ports/embedder.js';
import type {
  InventoryRepository,
  InventoryItemRecord,
  InventoryStatus,
} from '../../ports/inventory-repository.js';

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

  /** Embed title + description; best-effort — null on failure, never throws. */
  private async embed(title: string, description: string): Promise<number[] | null> {
    try {
      return await this.embedder.embed(`${title}\n${description}`);
    } catch {
      return null;
    }
  }
}
