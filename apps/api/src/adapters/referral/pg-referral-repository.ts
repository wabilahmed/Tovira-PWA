import type { Pool } from 'pg';
import type { ReferralRepository } from '../../ports/referral-repository.js';

/** Postgres referral ledger. The PK on referred_email enforces once-per-person. */
export class PgReferralRepository implements ReferralRepository {
  constructor(private readonly pool: Pool) {}

  async record(referrerId: string, referredEmail: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `INSERT INTO referrals (referred_email, referrer_id) VALUES ($1, $2)
       ON CONFLICT (referred_email) DO NOTHING
       RETURNING referred_email`,
      [referredEmail.trim().toLowerCase(), referrerId],
    );
    return rows.length > 0;
  }
}
