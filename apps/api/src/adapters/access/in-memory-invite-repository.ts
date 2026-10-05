import type { InviteRecord, InviteRepository } from '../../ports/invite-repository.js';

/** In-memory invite store for tests/local. Burn is atomic in JS's single-threaded model: the consume
 *  check-and-set runs to completion before any other awaited task resumes. */
export class InMemoryInviteRepository implements InviteRepository {
  private readonly byHash = new Map<string, InviteRecord & { consumedAt: number | null }>();

  /** Used by the approval tx to write the invite. */
  insert(rec: InviteRecord): void {
    this.byHash.set(rec.tokenHash, { ...rec, consumedAt: null });
  }

  /** Remove an invite (approval-tx rollback). */
  remove(tokenHash: string): void {
    this.byHash.delete(tokenHash);
  }

  async consume(tokenHash: string, nowMs: number): Promise<{ userId: string; accessRequestId: string } | null> {
    const inv = this.byHash.get(tokenHash);
    if (!inv || inv.consumedAt !== null || inv.expiresAt <= nowMs) return null;
    inv.consumedAt = nowMs; // single atomic check-and-set
    return { userId: inv.userId, accessRequestId: inv.accessRequestId };
  }

  async hasOutstanding(userId: string, nowMs: number): Promise<boolean> {
    for (const inv of this.byHash.values()) {
      if (inv.userId === userId && inv.consumedAt === null && inv.expiresAt > nowMs) return true;
    }
    return false;
  }

  async peek(tokenHash: string, nowMs: number): Promise<boolean> {
    const inv = this.byHash.get(tokenHash);
    return !!inv && inv.consumedAt === null && inv.expiresAt > nowMs;
  }

  async findByToken(tokenHash: string): Promise<InviteRecord | null> {
    const inv = this.byHash.get(tokenHash);
    return inv ? { tokenHash: inv.tokenHash, accessRequestId: inv.accessRequestId, userId: inv.userId, expiresAt: inv.expiresAt, createdBy: inv.createdBy } : null;
  }

  async reissue(input: { accessRequestId: string; userId: string; tokenHash: string; expiresAt: number; createdBy: string }): Promise<void> {
    // Invalidate every earlier link for this access request, then insert the new one (atomic in JS).
    for (const [hash, inv] of this.byHash) if (inv.accessRequestId === input.accessRequestId) this.byHash.delete(hash);
    this.byHash.set(input.tokenHash, { ...input, consumedAt: null });
  }
}
