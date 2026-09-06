import type { OpsAlertRepository, OpsAlert, NewOpsAlert } from '../../ports/ops-alert-repository.js';

/** In-memory ops-alert store (tests + local). Dedupes on (kind, dedupeKey). */
export class InMemoryOpsAlertRepository implements OpsAlertRepository {
  private readonly alerts: OpsAlert[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  async createIfAbsent(alert: NewOpsAlert): Promise<boolean> {
    if (this.alerts.some((a) => a.kind === alert.kind && a.dedupeKey === alert.dedupeKey)) return false;
    this.alerts.push({ id: `ops-${++this.seq}`, ...alert, createdAt: this.now() });
    return true;
  }

  async listRecent(limit: number): Promise<OpsAlert[]> {
    return [...this.alerts].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}
