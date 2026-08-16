import type { EmailLogRepository } from '../../ports/email-log-repository.js';

export class InMemoryEmailLogRepository implements EmailLogRepository {
  private readonly seen = new Set<string>();
  async recordIfAbsent(userId: string, eventKey: string): Promise<boolean> {
    const key = `${userId}:${eventKey}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
