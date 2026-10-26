import type { Pool } from 'pg';
import type { ExpleeSyncState, HotLead, HotLeadInput, HotLeadsStore, LeadStatus } from '../../ports/hot-leads.js';

interface Row {
  id: string; person_id: string; campaign_id: number; campaign_name: string | null; name: string | null; email: string | null; job_title: string | null;
  company_name: string | null; company_domain: string | null; linkedin_url: string | null; country: string | null; phone: string | null; why_hot: string | null;
  became_hot_at: Date | null; erased: boolean; status: LeadStatus; notes: string | null; access_request_id: string | null; first_seen_at: Date; updated_at: Date;
}
const toLead = (r: Row): HotLead => ({
  id: String(r.id), personId: r.person_id, campaignId: Number(r.campaign_id), campaignName: r.campaign_name, name: r.name, email: r.email, jobTitle: r.job_title,
  companyName: r.company_name, companyDomain: r.company_domain, linkedinUrl: r.linkedin_url, country: r.country, phone: r.phone, whyHot: r.why_hot,
  becameHotAt: r.became_hot_at?.getTime() ?? null, erased: r.erased, status: r.status, notes: r.notes, accessRequestId: r.access_request_id,
  firstSeenAt: r.first_seen_at.getTime(), updatedAt: r.updated_at.getTime(),
});
const COLS = 'id, person_id, campaign_id, campaign_name, name, email, job_title, company_name, company_domain, linkedin_url, country, phone, why_hot, became_hot_at, erased, status, notes, access_request_id, first_seen_at, updated_at';
const ts = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/**
 * [P45-3] Hot leads on the OWNER pool (never granted to the app role). One transaction per batch. A known lead's
 * details are refreshed but never its status or notes; an erased lead keeps nothing of the person (and a new erased
 * lead is not stored at all). (xmax = 0) tells an INSERT from an UPDATE, so the caller learns which leads are new.
 */
export class PgHotLeadsStore implements HotLeadsStore {
  constructor(private readonly pool: Pool) {}

  async saveBatch(batch: HotLeadInput[], at: number): Promise<HotLead[]> {
    const c = await this.pool.connect();
    const fresh: HotLead[] = [];
    try {
      await c.query('BEGIN');
      for (const l of batch) {
        if (l.erased) {
          await c.query(
            `UPDATE hot_leads SET erased = true, name = NULL, email = NULL, job_title = NULL, company_name = NULL, company_domain = NULL,
               linkedin_url = NULL, country = NULL, phone = NULL, why_hot = NULL, notes = NULL, updated_at = $3
             WHERE person_id = $1 AND campaign_id = $2`, [l.personId, l.campaignId, ts(at)]);
          continue;
        }
        const { rows } = await c.query<Row & { inserted: boolean }>(
          `INSERT INTO hot_leads (person_id, campaign_id, campaign_name, name, email, job_title, company_name, company_domain, linkedin_url, country, phone, why_hot, became_hot_at, first_seen_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
           ON CONFLICT (person_id, campaign_id) DO UPDATE SET
             campaign_name = EXCLUDED.campaign_name, name = EXCLUDED.name, email = EXCLUDED.email, job_title = EXCLUDED.job_title,
             company_name = EXCLUDED.company_name, company_domain = EXCLUDED.company_domain, linkedin_url = EXCLUDED.linkedin_url,
             country = EXCLUDED.country, phone = EXCLUDED.phone, why_hot = EXCLUDED.why_hot, became_hot_at = EXCLUDED.became_hot_at,
             updated_at = EXCLUDED.updated_at
           RETURNING ${COLS}, (xmax = 0) AS inserted`,
          [l.personId, l.campaignId, l.campaignName, l.name, l.email, l.jobTitle, l.companyName, l.companyDomain, l.linkedinUrl, l.country, l.phone, l.whyHot, ts(l.becameHotAt), ts(at)],
        );
        if (rows[0]?.inserted) fresh.push(toLead(rows[0]));
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
    return fresh;
  }

  async getState(): Promise<ExpleeSyncState> {
    const { rows } = await this.pool.query<{ cursor: Date | null; last_run_at: Date | null; last_status: string | null; banner: string | null }>('SELECT cursor, last_run_at, last_status, banner FROM explee_sync_state WHERE id');
    const r = rows[0];
    return { cursor: r?.cursor?.getTime() ?? null, lastRunAt: r?.last_run_at?.getTime() ?? null, lastStatus: r?.last_status ?? null, banner: r?.banner ?? null };
  }

  async setState(patch: Partial<ExpleeSyncState>): Promise<void> {
    const cur = await this.getState();
    const next = { ...cur, ...patch };
    await this.pool.query(
      `INSERT INTO explee_sync_state (id, cursor, last_run_at, last_status, banner) VALUES (true, $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET cursor = EXCLUDED.cursor, last_run_at = EXCLUDED.last_run_at, last_status = EXCLUDED.last_status, banner = EXCLUDED.banner`,
      [ts(next.cursor), ts(next.lastRunAt), next.lastStatus, next.banner],
    );
  }

  async list(f: { status?: LeadStatus; country?: string }): Promise<HotLead[]> {
    const where: string[] = []; const vals: unknown[] = [];
    if (f.status) { vals.push(f.status); where.push(`status = $${vals.length}`); }
    if (f.country) { vals.push(f.country); where.push(`country = $${vals.length}`); }
    const { rows } = await this.pool.query<Row>(`SELECT ${COLS} FROM hot_leads ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY became_hot_at DESC NULLS LAST, id DESC LIMIT 2000`, vals);
    return rows.map(toLead);
  }

  async get(id: string): Promise<HotLead | null> {
    if (!/^\d+$/.test(id)) return null;
    const { rows } = await this.pool.query<Row>(`SELECT ${COLS} FROM hot_leads WHERE id = $1`, [id]);
    return rows[0] ? toLead(rows[0]) : null;
  }

  async update(id: string, patch: { status?: LeadStatus; notes?: string | null; accessRequestId?: string | null }, at: number): Promise<HotLead | null> {
    if (!/^\d+$/.test(id)) return null;
    const sets: string[] = []; const vals: unknown[] = [id];
    if (patch.status !== undefined) { vals.push(patch.status); sets.push(`status = $${vals.length}`); }
    if (patch.notes !== undefined) { vals.push(patch.notes); sets.push(`notes = $${vals.length}`); }
    if (patch.accessRequestId !== undefined) { vals.push(patch.accessRequestId); sets.push(`access_request_id = $${vals.length}`); }
    vals.push(ts(at)); sets.push(`updated_at = $${vals.length}`);
    const { rows } = await this.pool.query<Row>(`UPDATE hot_leads SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`, vals);
    return rows[0] ? toLead(rows[0]) : null;
  }

  async markSignedUpByEmail(email: string, at: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE hot_leads SET status = 'signed_up', updated_at = $2 WHERE lower(email) = lower($1) AND status <> 'signed_up'`, [email.trim(), ts(at)]);
    return rowCount ?? 0;
  }
}
