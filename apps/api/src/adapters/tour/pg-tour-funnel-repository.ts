import type { Pool } from 'pg';
import type { TourFunnelEvent, TourFunnelRepository, TourFunnelRow } from '../../ports/tour-funnel-repository.js';

/** [P37] Postgres tour funnel: one upserted counter row per (version, step, event); step -1 = whole tour. */
export class PgTourFunnelRepository implements TourFunnelRepository {
  constructor(private readonly pool: Pool) {}
  async bump(version: number, step: number | null, event: TourFunnelEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO tour_funnel (tour_version, step, event, count) VALUES ($1, $2, $3, 1)
       ON CONFLICT (tour_version, step, event) DO UPDATE SET count = tour_funnel.count + 1, updated_at = now()`,
      [version, step ?? -1, event],
    );
  }
  async list(): Promise<TourFunnelRow[]> {
    const { rows } = await this.pool.query<{ tour_version: number; step: number; event: TourFunnelEvent; count: string }>(
      'SELECT tour_version, step, event, count FROM tour_funnel ORDER BY tour_version, step, event');
    return rows.map((r) => ({ version: r.tour_version, step: r.step < 0 ? null : r.step, event: r.event, count: Number(r.count) }));
  }
}
