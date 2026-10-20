import type { TourFunnelEvent, TourFunnelRepository, TourFunnelRow } from '../../ports/tour-funnel-repository.js';

/** In-memory tour funnel (tests). */
export class InMemoryTourFunnelRepository implements TourFunnelRepository {
  private readonly counts = new Map<string, TourFunnelRow>();
  async bump(version: number, step: number | null, event: TourFunnelEvent): Promise<void> {
    const k = `${version}|${step ?? -1}|${event}`;
    const row = this.counts.get(k) ?? { version, step, event, count: 0 };
    row.count += 1;
    this.counts.set(k, row);
  }
  async list(): Promise<TourFunnelRow[]> {
    return [...this.counts.values()].map((r) => ({ ...r })).sort((a, b) => a.version - b.version || (a.step ?? -1) - (b.step ?? -1) || a.event.localeCompare(b.event));
  }
}
