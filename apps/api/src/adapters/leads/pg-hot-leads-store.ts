import type { Pool } from 'pg';
import type { ExpleeSyncState, HotLead, HotLeadInput, HotLeadsStore, LeadStatus } from '../../ports/hot-leads.js';
import { LEAD_INVITE_RESEND_AFTER_MS } from '../../ports/hot-leads.js';

interface Row {
  id: string; person_id: string; campaign_id: number; campaign_name: string | null; name: string | null; email: string | null; job_title: string | null;
  company_name: string | null; company_domain: string | null; linkedin_url: string | null; country: string | null; phone: string | null; why_hot: string | null;
  became_hot_at: Date | null; erased: boolean; status: LeadStatus; notes: string | null; access_request_id: string | null; first_seen_at: Date; updated_at: Date;
  is_test: boolean; invite_sent_at: Date | null; invite_resent_at: Date | null; invite_expires_at: Date | null; requested_at: Date | null;
}
const toLead = (r: Row): HotLead => ({
  id: String(r.id), personId: r.person_id, campaignId: Number(r.campaign_id), campaignName: r.campaign_name, name: r.name, email: r.email, jobTitle: r.job_title,
  companyName: r.company_name, companyDomain: r.company_domain, linkedinUrl: r.linkedin_url, country: r.country, phone: r.phone, whyHot: r.why_hot,
  becameHotAt: r.became_hot_at?.getTime() ?? null, erased: r.erased, status: r.status, notes: r.notes, accessRequestId: r.access_request_id,
  firstSeenAt: r.first_seen_at.getTime(), updatedAt: r.updated_at.getTime(),
  isTest: r.is_test, inviteSentAt: r.invite_sent_at?.getTime() ?? null, inviteResentAt: r.invite_resent_at?.getTime() ?? null,
  inviteExpiresAt: r.invite_expires_at?.getTime() ?? null, requestedAt: r.requested_at?.getTime() ?? null,
});
const COLS = 'id, person_id, campaign_id, campaign_name, name, email, job_title, company_name, company_domain, linkedin_url, country, phone, why_hot, became_hot_at, erased, status, notes, access_request_id, first_seen_at, updated_at, is_test, invite_sent_at, invite_resent_at, invite_expires_at, requested_at';
const ts = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/**
 * [P45-3] Hot leads on the OWNER pool (never granted to the app role). One transaction per batch. A known lead's
 * details are refreshed but never its status or notes. [P46-6c.4] An erased lead keeps nothing of the person: its row
 * is deleted and a tombstone (person_id + campaign_id) stops any later poll from importing it again. (xmax = 0) tells an INSERT from an UPDATE, so the caller learns which leads are new.
 */
export class PgHotLeadsStore implements HotLeadsStore {
  constructor(private readonly pool: Pool) {}

  async saveBatch(batch: HotLeadInput[], at: number): Promise<HotLead[]> {
    const c = await this.pool.connect();
    const fresh: HotLead[] = [];
    try {
      await c.query('BEGIN');
      for (const l of batch) {
        // [P46-6c.4] Wiped once: never imported again (the poll's at-or-after overlap, or an older copy from Explee).
        const { rows: dead } = await c.query('SELECT 1 FROM hot_lead_tombstones WHERE person_id = $1 AND campaign_id = $2', [l.personId, l.campaignId]);
        if (dead.length > 0) continue;
        if (l.erased) {
          // Nothing of the person is kept: the lead's row goes; only person_id + campaign_id stay, as the tombstone.
          await c.query('DELETE FROM hot_leads WHERE person_id = $1 AND campaign_id = $2', [l.personId, l.campaignId]);
          await c.query('INSERT INTO hot_lead_tombstones (person_id, campaign_id, erased_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [l.personId, l.campaignId, ts(at)]);
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

  async createTestLead(i: { name: string; email: string; companyName: string | null; jobTitle: string | null }, at: number): Promise<HotLead> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO hot_leads (person_id, campaign_id, campaign_name, name, email, job_title, company_name, became_hot_at, first_seen_at, updated_at, is_test)
       VALUES ('test:' || gen_random_uuid(), 0, 'Test', $1, $2, $3, $4, $5, $5, $5, true) RETURNING ${COLS}`,
      [i.name, i.email, i.jobTitle, i.companyName, ts(at)]);
    return toLead(rows[0]!);
  }

  async setInvite(id: string, i: { tokenHash: string; at: number; expiresAt: number; resend: boolean }): Promise<HotLead | null> {
    if (!/^\d+$/.test(id)) return null;
    // one conditional UPDATE: two taps (or two admins) can never both send
    const cond = i.resend
      ? `invite_sent_at IS NOT NULL AND invite_resent_at IS NULL AND invite_sent_at <= $5::timestamptz`
      : 'invite_sent_at IS NULL';
    const vals: unknown[] = [id, i.tokenHash, ts(i.at), ts(i.expiresAt)];
    if (i.resend) vals.push(ts(i.at - LEAD_INVITE_RESEND_AFTER_MS)); // $5: the latest send that may be re-sent now
    const { rows } = await this.pool.query<Row>(
      `UPDATE hot_leads SET invite_token_hash = $2, ${i.resend ? 'invite_resent_at' : 'invite_sent_at'} = $3::timestamptz, invite_expires_at = $4::timestamptz, invite_used_at = NULL,
         status = CASE WHEN status IN ('new', 'contacted') THEN 'invited' ELSE status END, updated_at = $3::timestamptz
       WHERE id = $1 AND ${cond} RETURNING ${COLS}`,
      vals);
    return rows[0] ? toLead(rows[0]) : null;
  }

  async restoreInvite(id: string, prev: Pick<HotLead, 'status' | 'inviteSentAt' | 'inviteResentAt' | 'inviteExpiresAt'>, at: number): Promise<void> {
    if (!/^\d+$/.test(id)) return;
    await this.pool.query(
      `UPDATE hot_leads SET status = $2, invite_sent_at = $3, invite_resent_at = $4, invite_expires_at = $5, invite_token_hash = NULL, updated_at = $6 WHERE id = $1`,
      [id, prev.status, ts(prev.inviteSentAt ?? null), ts(prev.inviteResentAt ?? null), ts(prev.inviteExpiresAt ?? null), ts(at)]);
  }

  async findByInviteToken(tokenHash: string, at: number): Promise<HotLead | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLS} FROM hot_leads WHERE invite_token_hash = $1 AND invite_used_at IS NULL AND invite_expires_at > $2`, [tokenHash, ts(at)]);
    return rows[0] ? toLead(rows[0]) : null;
  }

  async markRequested(id: string, tokenHash: string, accessRequestId: string, at: number): Promise<HotLead | null> {
    if (!/^\d+$/.test(id)) return null;
    const { rows } = await this.pool.query<Row>(
      `UPDATE hot_leads SET invite_used_at = $4, status = 'requested', requested_at = $4, access_request_id = $3, updated_at = $4
       WHERE id = $1 AND invite_token_hash = $2 AND invite_used_at IS NULL RETURNING ${COLS}`,
      [id, tokenHash, accessRequestId, ts(at)]);
    return rows[0] ? toLead(rows[0]) : null;
  }

  async markSignedUpByEmail(email: string, at: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE hot_leads SET status = 'signed_up', updated_at = $2 WHERE lower(email) = lower($1) AND status <> 'signed_up'`, [email.trim(), ts(at)]);
    return rowCount ?? 0;
  }
}
