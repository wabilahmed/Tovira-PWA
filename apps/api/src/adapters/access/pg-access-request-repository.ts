import type { Pool } from 'pg';
import type { AccessRequestInput, AccessRequestRecord, AccessRequestRepository, AccessRequestReview, AccessRequestStatus, ConversationOwnership, ExpectedVolume, Industry, Ownership, AnswersPatch } from '../../ports/access-request-repository.js';

export interface Row {
  id: string;
  created_at: Date;
  status: AccessRequestStatus;
  full_name: string;
  work_email: string;
  phone: string | null;
  company_name: string;
  role_title: string;
  ownership: Ownership | null;
  trade_licence_number: string | null;
  conversation_ownership: ConversationOwnership | null;
  conversation_ownership_other: string | null;
  expected_volume: ExpectedVolume | null;
  confirmation_accepted_at: Date | null;
  confirmation_text_version: string | null;
  source_ip: string | null;
  user_agent: string | null;
  reviewed_at: Date | null;
  reviewed_note: string | null;
  linked_user_id: string | null;
  referral_code: string | null;
  /** [P42-A6] migration 0095; null before it. */
  industry: Industry | null;
  industry_other: string | null;
  /** [P45-3] migration 0099 */
  source?: 'form' | 'hot_lead' | null;
  /** [P59-1] migration 0108 */
  employer_permission_accepted_at?: Date | null;
  employer_permission_text?: string | null;
}

export function rowToAccessRequest(r: Row): AccessRequestRecord {
  return toRecord(r);
}

function toRecord(r: Row): AccessRequestRecord {
  return {
    id: r.id,
    createdAt: r.created_at.getTime(),
    status: r.status,
    fullName: r.full_name,
    workEmail: r.work_email,
    phone: r.phone,
    companyName: r.company_name,
    roleTitle: r.role_title,
    ownership: r.ownership,
    tradeLicenceNumber: r.trade_licence_number,
    conversationOwnership: r.conversation_ownership,
    conversationOwnershipOther: r.conversation_ownership_other,
    expectedVolume: r.expected_volume,
    confirmationAcceptedAt: r.confirmation_accepted_at ? r.confirmation_accepted_at.getTime() : null,
    confirmationTextVersion: r.confirmation_text_version,
    sourceIp: r.source_ip,
    userAgent: r.user_agent,
    reviewedAt: r.reviewed_at ? r.reviewed_at.getTime() : null,
    reviewedNote: r.reviewed_note,
    linkedUserId: r.linked_user_id,
    referralCode: r.referral_code,
    industry: r.industry ?? null,
    industryOther: r.industry_other ?? null,
    source: r.source ?? 'form',
    employerPermissionAcceptedAt: r.employer_permission_accepted_at ? r.employer_permission_accepted_at.getTime() : null,
    employerPermissionText: r.employer_permission_text ?? null,
  };
}

const COLS =
  'id, created_at, status, full_name, work_email, phone, company_name, role_title, ownership, trade_licence_number, conversation_ownership, conversation_ownership_other, expected_volume, confirmation_accepted_at, confirmation_text_version, source_ip, user_agent, reviewed_at, reviewed_note, linked_user_id, referral_code, industry, industry_other, source, employer_permission_accepted_at, employer_permission_text';

/** Postgres-backed access-request store (pre-tenant; no RLS, granted to tovira_app — see 0073). */
export class PgAccessRequestRepository implements AccessRequestRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: AccessRequestInput): Promise<AccessRequestRecord> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO access_requests
         (full_name, work_email, phone, company_name, role_title, ownership, trade_licence_number,
          conversation_ownership, conversation_ownership_other, expected_volume,
          confirmation_accepted_at, confirmation_text_version, source_ip, user_agent, referral_code, industry, industry_other, source,
          employer_permission_accepted_at, employer_permission_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11::double precision IS NULL THEN NULL ELSE to_timestamp($11 / 1000.0) END, $12, $13, $14, $15, $16, $17, $18,
          CASE WHEN $19::double precision IS NULL THEN NULL ELSE to_timestamp($19 / 1000.0) END, $20)
       RETURNING ${COLS}`,
      [
        input.fullName, input.workEmail, input.phone, input.companyName, input.roleTitle,
        input.ownership, input.tradeLicenceNumber, input.conversationOwnership, input.conversationOwnershipOther,
        input.expectedVolume, input.confirmationAcceptedAt, input.confirmationTextVersion, input.sourceIp, input.userAgent, input.referralCode,
        input.industry ?? null, input.industryOther ?? null, input.source ?? 'form',
        input.employerPermissionAcceptedAt ?? null, input.employerPermissionText ?? null,
      ],
    );
    return toRecord(rows[0]!);
  }

  async get(id: string): Promise<AccessRequestRecord | null> {
    const { rows } = await this.pool.query<Row>(`SELECT ${COLS} FROM access_requests WHERE id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async list(status?: AccessRequestStatus): Promise<AccessRequestRecord[]> {
    const { rows } = status
      ? await this.pool.query<Row>(`SELECT ${COLS} FROM access_requests WHERE status = $1 ORDER BY created_at DESC`, [status])
      : await this.pool.query<Row>(`SELECT ${COLS} FROM access_requests ORDER BY created_at DESC`);
    return rows.map(toRecord);
  }

  async review(id: string, patch: AccessRequestReview): Promise<AccessRequestRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE access_requests
         SET status = $2, reviewed_at = to_timestamp($3 / 1000.0), reviewed_note = $4, linked_user_id = COALESCE($5, linked_user_id)
       WHERE id = $1 RETURNING ${COLS}`,
      [id, patch.status, patch.reviewedAt, patch.reviewedNote ?? null, patch.linkedUserId ?? null],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByLinkedUser(userId: string): Promise<AccessRequestRecord | null> {
    const { rows } = await this.pool.query<Row>(`SELECT ${COLS} FROM access_requests WHERE linked_user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async completeAnswers(id: string, a: AnswersPatch): Promise<AccessRequestRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE access_requests
          SET phone = $2, ownership = $3, trade_licence_number = $4, conversation_ownership = $5, conversation_ownership_other = $6,
              expected_volume = $7, industry = $8, industry_other = $9,
              confirmation_accepted_at = to_timestamp($10 / 1000.0), confirmation_text_version = $11
        WHERE id = $1 RETURNING ${COLS}`,
      [id, a.phone, a.ownership, a.tradeLicenceNumber, a.conversationOwnership, a.conversationOwnershipOther, a.expectedVolume, a.industry, a.industryOther, a.confirmationAcceptedAt, a.confirmationTextVersion],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async deleteStale(cutoffMs: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM access_requests WHERE created_at < to_timestamp($1 / 1000.0) AND status IN ('pending', 'rejected')`,
      [cutoffMs],
    );
    return rowCount ?? 0;
  }
}
