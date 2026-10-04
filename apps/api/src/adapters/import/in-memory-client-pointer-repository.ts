import type { ClientPointerRepository, ClientPointerSet } from '../../ports/client-pointer-repository.js';
import type { Pointer } from '../../services/extraction/types.js';

/** In-memory per-client pointer store mirroring the RLS isolation contract, for tests. */
export class InMemoryClientPointerRepository implements ClientPointerRepository {
  private readonly byKey = new Map<string, ClientPointerSet>();
  private key(userId: string, clientId: string): string { return `${userId}\u0000${clientId}`; }

  async getForClient(userId: string, clientId: string): Promise<ClientPointerSet | null> {
    const s = this.byKey.get(this.key(userId, clientId));
    return s ? { ...s, pointers: s.pointers.map((p) => ({ ...p })) } : null;
  }

  async save(userId: string, clientId: string, set: { pointers: Pointer[]; retrospectiveDisclosure: string | null }, nowMs: number): Promise<void> {
    this.byKey.set(this.key(userId, clientId), { clientId, pointers: set.pointers, retrospectiveDisclosure: set.retrospectiveDisclosure, updatedAt: nowMs });
  }

  async deleteForClient(userId: string, clientId: string): Promise<void> {
    this.byKey.delete(this.key(userId, clientId));
  }

  async purgeUser(userId: string): Promise<void> {
    for (const k of [...this.byKey.keys()]) if (k.startsWith(`${userId}\u0000`)) this.byKey.delete(k);
  }

  async listByUser(userId: string): Promise<ClientPointerSet[]> {
    return [...this.byKey.entries()].filter(([k]) => k.startsWith(`${userId}\u0000`)).map(([, v]) => v);
  }
}
