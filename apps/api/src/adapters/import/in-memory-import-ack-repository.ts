import type { ImportAckRepository } from '../../ports/import-ack-repository.js';

/** In-memory first-import acknowledgement store (tests). One timestamp per account; first write wins. */
export class InMemoryImportAckRepository implements ImportAckRepository {
  private readonly byUser = new Map<string, number>();

  async acknowledgedAt(userId: string): Promise<number | null> {
    return this.byUser.get(userId) ?? null;
  }

  async acknowledge(userId: string, atMs: number): Promise<void> {
    if (!this.byUser.has(userId)) this.byUser.set(userId, atMs); // first write wins
  }

  async purgeUser(userId: string): Promise<void> {
    this.byUser.delete(userId);
  }
}
