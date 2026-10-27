import { randomUUID } from 'node:crypto';
import type { GoingQuietAlert, GoingQuietAlertRepository } from '../../ports/going-quiet-alert-repository.js';

/** [P47-2] In-memory going-quiet alerts (tests, local), same rules as pg: one per silence, the first reach kept. */
export class InMemoryGoingQuietAlertRepository implements GoingQuietAlertRepository {
  private rows: Array<GoingQuietAlert & { userId: string }> = [];
  async recordReached(userId: string, a: Omit<GoingQuietAlert, 'id'>): Promise<void> {
    if (this.rows.some((r) => r.userId === userId && r.clientId === a.clientId && r.quietSince === a.quietSince)) return;
    this.rows.push({ ...a, id: randomUUID(), userId });
  }
  async listByUser(userId: string): Promise<GoingQuietAlert[]> {
    return this.rows.filter((r) => r.userId === userId).map(({ userId: _u, ...r }) => ({ ...r }));
  }
  async purgeUser(userId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.userId !== userId);
  }
}
