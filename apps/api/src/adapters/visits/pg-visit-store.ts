import type { Pool } from 'pg';
import type { DayRollup, PageView, VisitStore } from '../../services/visits/visits.js';
import { rollupOf } from '../../services/visits/visits.js';

/** [P63-7] Site visits in Postgres (OWNER pool; never granted to the app role). See migration 0112. */
const day = (v: unknown): string => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10));

export class PgVisitStore implements VisitStore {
  constructor(private readonly pool: Pool) {}
  async saltFor(d: string, fresh: () => string): Promise<string> {
    await this.pool.query('INSERT INTO visit_salts (day, salt) VALUES ($1::date, $2) ON CONFLICT (day) DO NOTHING', [d, fresh()]);
    const { rows } = await this.pool.query<{ salt: string }>('SELECT salt FROM visit_salts WHERE day = $1::date', [d]);
    return rows[0]!.salt;
  }
  async isExcluded(d: string, hash: string): Promise<boolean> {
    const { rows } = await this.pool.query('SELECT 1 FROM visit_excluded WHERE day = $1::date AND visitor_hash = $2', [d, hash]);
    return rows.length > 0;
  }
  async exclude(d: string, hash: string): Promise<void> {
    await this.pool.query('INSERT INTO visit_excluded (day, visitor_hash) VALUES ($1::date, $2) ON CONFLICT DO NOTHING', [d, hash]);
    await this.pool.query('DELETE FROM page_views WHERE day = $1::date AND visitor_hash = $2', [d, hash]);
  }
  async add(v: PageView): Promise<void> {
    await this.pool.query(
      'INSERT INTO page_views (day, page, referrer_domain, utm_source, utm_campaign, device, visitor_hash) VALUES ($1::date, $2, $3, $4, $5, $6, $7)',
      [v.day, v.page, v.referrerDomain, v.utmSource, v.utmCampaign, v.device, v.visitorHash],
    );
  }
  async rollupBefore(today: string): Promise<number> {
    const { rows: pending } = await this.pool.query<{ day: unknown }>('SELECT DISTINCT day::text AS day FROM page_views WHERE day < $1::date AND visitor_hash IS NOT NULL', [today]);
    for (const p of pending) {
      const d = day(p.day);
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        const { rows } = await c.query('SELECT page, visitor_hash FROM page_views WHERE day = $1::date FOR UPDATE', [d]);
        const r = rollupOf(d, rows.map((x) => ({ day: d, page: x.page, visitorHash: x.visitor_hash, referrerDomain: null, utmSource: null, utmCampaign: null, device: 'desktop' as const })));
        await c.query(
          `INSERT INTO visit_days (day, views, uniques, landing_uniques, reached_request, submitted) VALUES ($1::date, $2, $3, $4, $5, $6)
           ON CONFLICT (day) DO UPDATE SET views = EXCLUDED.views, uniques = EXCLUDED.uniques, landing_uniques = EXCLUDED.landing_uniques, reached_request = EXCLUDED.reached_request, submitted = EXCLUDED.submitted`,
          [d, r.views, r.uniques, r.landingUniques, r.reachedRequest, r.submitted],
        );
        await c.query('UPDATE page_views SET visitor_hash = NULL WHERE day = $1::date', [d]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
    }
    await this.pool.query('DELETE FROM visit_salts WHERE day < $1::date', [today]);
    await this.pool.query('DELETE FROM visit_excluded WHERE day < $1::date', [today]);
    return pending.length;
  }
  async views(sinceDay: string | null): Promise<PageView[]> {
    const { rows } = await this.pool.query(
      `SELECT day::text AS day, page, referrer_domain, utm_source, utm_campaign, device, visitor_hash FROM page_views ${sinceDay ? 'WHERE day >= $1::date' : ''}`,
      sinceDay ? [sinceDay] : [],
    );
    return rows.map((r) => ({ day: day(r.day), page: r.page, referrerDomain: r.referrer_domain, utmSource: r.utm_source, utmCampaign: r.utm_campaign, device: r.device, visitorHash: r.visitor_hash }));
  }
  async rollups(sinceDay: string | null): Promise<DayRollup[]> {
    const { rows } = await this.pool.query(
      `SELECT day::text AS day, views, uniques, landing_uniques, reached_request, submitted FROM visit_days ${sinceDay ? 'WHERE day >= $1::date' : ''}`,
      sinceDay ? [sinceDay] : [],
    );
    return rows.map((r) => ({ day: day(r.day), views: r.views, uniques: r.uniques, landingUniques: r.landing_uniques, reachedRequest: r.reached_request, submitted: r.submitted }));
  }
}
