import type { EmailVerificationRecord, EmailVerificationRepository } from '../../ports/email-verification-repository.js';

interface Row extends EmailVerificationRecord { used: boolean }

export class InMemoryEmailVerificationRepository implements EmailVerificationRepository {
  private readonly byHash = new Map<string, Row>();

  async create(record: EmailVerificationRecord): Promise<void> {
    this.byHash.set(record.tokenHash, { ...record, used: false });
  }
  async consume(tokenHash: string, nowMs: number): Promise<string | null> {
    const row = this.byHash.get(tokenHash);
    if (!row || row.used || row.expiresAt <= nowMs) return null;
    row.used = true;
    return row.userId;
  }
  async countCreatedSince(userId: string, sinceMs: number): Promise<number> {
    return [...this.byHash.values()].filter((r) => r.userId === userId && r.createdAt >= sinceMs).length;
  }
}
