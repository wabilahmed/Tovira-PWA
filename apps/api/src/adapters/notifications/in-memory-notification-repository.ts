import { randomUUID } from 'node:crypto';
import type {
  NotificationEntry,
  NotificationRecord,
  NotificationRepository,
} from '../../ports/notification-repository.js';

/** In-memory notification store for tests. */
export class InMemoryNotificationRepository implements NotificationRepository {
  private rows: NotificationRecord[] = [];

  async createIfAbsent(userId: string, entry: NotificationEntry): Promise<boolean> {
    if (this.rows.some((r) => r.userId === userId && r.dedupeKey === entry.dedupeKey)) return false;
    this.rows.push({ ...entry, id: randomUUID(), userId, read: false, createdAt: Date.now() });
    return true;
  }

  async listByUser(userId: string): Promise<NotificationRecord[]> {
    return this.rows.filter((r) => r.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const r = this.rows.find((x) => x.userId === userId && x.id === id);
    if (!r) return false;
    r.read = true;
    return true;
  }
}
