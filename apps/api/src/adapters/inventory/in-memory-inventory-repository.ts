import { randomUUID } from 'node:crypto';
import type {
  InventoryItemRecord,
  InventoryItemInput,
  InventoryItemPatch,
  InventoryRepository,
  InventoryStatus,
  InventoryShareRecord,
  ShareInput,
  ShareOutcomePatch,
} from '../../ports/inventory-repository.js';

/** In-memory inventory store mirroring the RLS isolation contract, for tests. */
export class InMemoryInventoryRepository implements InventoryRepository {
  private readonly byId = new Map<string, InventoryItemRecord & { hasVector: boolean }>();
  private readonly shares = new Map<string, InventoryShareRecord>();
  private clock = 0;

  private tick(): number {
    this.clock = Math.max(Date.now(), this.clock + 1);
    return this.clock;
  }

  private view(r: InventoryItemRecord): InventoryItemRecord {
    return { id: r.id, userId: r.userId, title: r.title, description: r.description, quantity: r.quantity, status: r.status, disabledReason: r.disabledReason, embedded: r.embedded, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }

  async create(userId: string, input: InventoryItemInput): Promise<InventoryItemRecord> {
    const now = this.tick();
    const record: InventoryItemRecord & { hasVector: boolean } = {
      id: randomUUID(), userId,
      title: input.title, description: input.description, quantity: input.quantity,
      status: 'active', disabledReason: null,
      embedded: (input.embedding?.length ?? 0) > 0, hasVector: (input.embedding?.length ?? 0) > 0,
      createdAt: now, updatedAt: now,
    };
    this.byId.set(record.id, record);
    return this.view(record);
  }

  async listByUser(userId: string, status?: InventoryStatus): Promise<InventoryItemRecord[]> {
    return [...this.byId.values()]
      .filter((r) => r.userId === userId && (status === undefined || r.status === status))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => this.view(r));
  }

  async findByIdForUser(userId: string, id: string): Promise<InventoryItemRecord | null> {
    const r = this.byId.get(id);
    return r && r.userId === userId ? this.view(r) : null;
  }

  async update(userId: string, id: string, patch: InventoryItemPatch): Promise<InventoryItemRecord | null> {
    const r = this.byId.get(id);
    if (!r || r.userId !== userId) return null;
    if (patch.title !== undefined) r.title = patch.title;
    if (patch.description !== undefined) r.description = patch.description;
    if (patch.quantity !== undefined) r.quantity = patch.quantity;
    if (patch.status !== undefined) r.status = patch.status;
    if (patch.disabledReason !== undefined) r.disabledReason = patch.disabledReason;
    if (patch.embedding !== undefined) { r.embedded = (patch.embedding?.length ?? 0) > 0; r.hasVector = r.embedded; }
    r.updatedAt = this.tick();
    return this.view(r);
  }

  async purgeUser(userId: string): Promise<void> {
    for (const [id, r] of this.byId) if (r.userId === userId) this.byId.delete(id);
    for (const [id, s] of this.shares) if (s.userId === userId) this.shares.delete(id);
  }

  async createShare(userId: string, input: ShareInput): Promise<InventoryShareRecord> {
    const record: InventoryShareRecord = {
      id: randomUUID(), userId, itemId: input.itemId, clientId: input.clientId,
      sharedAt: this.tick(), outcome: 'pending', outcomeSetBy: input.outcomeSetBy ?? 'rep', quantityBought: null,
    };
    this.shares.set(record.id, record);
    return { ...record };
  }

  async listSharesByItem(userId: string, itemId: string): Promise<InventoryShareRecord[]> {
    return [...this.shares.values()].filter((s) => s.userId === userId && s.itemId === itemId).sort((a, b) => b.sharedAt - a.sharedAt).map((s) => ({ ...s }));
  }

  async listSharesByClient(userId: string, clientId: string): Promise<InventoryShareRecord[]> {
    return [...this.shares.values()].filter((s) => s.userId === userId && s.clientId === clientId).sort((a, b) => b.sharedAt - a.sharedAt).map((s) => ({ ...s }));
  }

  async findShareForUser(userId: string, shareId: string): Promise<InventoryShareRecord | null> {
    const s = this.shares.get(shareId);
    return s && s.userId === userId ? { ...s } : null;
  }

  async updateShareOutcome(userId: string, shareId: string, patch: ShareOutcomePatch): Promise<InventoryShareRecord | null> {
    const s = this.shares.get(shareId);
    if (!s || s.userId !== userId) return null;
    s.outcome = patch.outcome;
    if (patch.quantityBought !== undefined) s.quantityBought = patch.quantityBought;
    return { ...s };
  }
}
