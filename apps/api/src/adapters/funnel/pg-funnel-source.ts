import type { Pool } from 'pg';
import type { FunnelPerson, FunnelSource } from '../../services/funnel/funnel.js';

/**
 * [P63-6] The funnel's rows from our own tables (OWNER pool: hot_leads is never granted to the app role).
 * Invited leads (an invite email sent), then every access request not reached through an invite.
 */
const PERSON_STEPS = (userCol: string) => `
  (SELECT min(i.consumed_at) FROM invites i WHERE i.access_request_id = a.id) AS password_set_at,
  LEAST((SELECT e.sent_at FROM email_log e WHERE e.user_id = ${userCol} AND e.event_key = 'admin.first_sign_in'),
        (SELECT min(s.created_at) FROM sessions s WHERE s.user_id = ${userCol})) AS first_sign_in_at,
  LEAST((SELECT e.sent_at FROM email_log e WHERE e.user_id = ${userCol} AND e.event_key = 'admin.first_capture'),
        (SELECT min(n.created_at) FROM notes n WHERE n.user_id = ${userCol})) AS first_client_at`;
const APPROVED = `CASE WHEN a.status IN ('approved', 'invited', 'activated') THEN coalesce(a.reviewed_at, a.created_at) END`;

export const FUNNEL_LEADS_SQL = `
SELECT 'lead:' || h.id AS key, h.name, h.email, h.company_name AS company, 'invite' AS source, h.is_test,
       h.invite_sent_at, h.invite_opened_at, h.requested_at AS submitted_at, ${APPROVED} AS approved_at,
       ${PERSON_STEPS('a.linked_user_id')}
  FROM hot_leads h
  LEFT JOIN access_requests a ON a.id = h.access_request_id
 WHERE h.invite_sent_at IS NOT NULL`;
export const FUNNEL_REQUESTS_SQL = `
SELECT 'request:' || a.id AS key, a.full_name AS name, a.work_email AS email, a.company_name AS company,
       CASE WHEN a.source = 'form' THEN 'public' ELSE 'admin' END AS source,
       (a.work_email ILIKE '%+test%' OR a.full_name ILIKE 'TEST %') AS is_test,
       NULL::timestamptz AS invite_sent_at, NULL::timestamptz AS invite_opened_at,
       CASE WHEN a.source = 'form' THEN a.created_at END AS submitted_at, ${APPROVED} AS approved_at,
       ${PERSON_STEPS('a.linked_user_id')}
  FROM access_requests a
 WHERE NOT EXISTS (SELECT 1 FROM hot_leads h WHERE h.access_request_id = a.id AND h.invite_sent_at IS NOT NULL)`;

const ms = (v: unknown): number | null => (v == null ? null : new Date(v as string | Date).getTime());
const str = (v: unknown): string | null => (v == null ? null : String(v));

export function toFunnelPerson(r: Record<string, unknown>): FunnelPerson {
  return {
    key: String(r.key), name: str(r.name), email: str(r.email), company: str(r.company),
    source: r.source as FunnelPerson['source'], isTest: r.is_test === true,
    inviteSentAt: ms(r.invite_sent_at), inviteOpenedAt: ms(r.invite_opened_at), submittedAt: ms(r.submitted_at),
    approvedAt: ms(r.approved_at), passwordSetAt: ms(r.password_set_at), firstSignInAt: ms(r.first_sign_in_at),
    firstClientAt: ms(r.first_client_at),
  };
}

export class PgFunnelSource implements FunnelSource {
  constructor(private readonly pool: Pool) {}
  async people(): Promise<FunnelPerson[]> {
    const [leads, requests] = await Promise.all([this.pool.query(FUNNEL_LEADS_SQL), this.pool.query(FUNNEL_REQUESTS_SQL)]);
    return [...leads.rows, ...requests.rows].map(toFunnelPerson);
  }
}
