import type { PasswordResetRecord, PasswordResetRepository } from '../../ports/password-reset-repository.js';

interface Row extends PasswordResetRecord { used: boolean }

/** In-memory reset-token store for tests/local. */
export class InMemoryPasswordResetRepository implements PasswordResetRepository {
  private readonly byHash = new Map<string, Row>();

  async create(record: PasswordResetRecord): Promise<void> {
    this.byHash.set(record.tokenHash, { ...record, used: false });
  }

  async consume(tokenHash: string, nowMs: number): Promise<string | null> {
    const row = this.byHash.get(tokenHash);
    if (!row || row.used || row.expiresAt <= nowMs) return null;
    row.used = true;
    return row.userId;
  }

  async deleteForUser(userId: string): Promise<void> {
    for (const [hash, row] of this.byHash) if (row.userId === userId) this.byHash.delete(hash);
  }
}
