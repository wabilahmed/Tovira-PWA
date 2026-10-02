import type { Pool } from 'pg';
import type { RepGlossaryEntry, RepGlossaryRepository } from '../../ports/rep-glossary-repository.js';
import { withTenant } from '../../db/tenant.js';

interface Row { wrong_term: string; right_term: string; times_corrected: number; first_seen: Date; last_seen: Date }

/** Postgres per-rep glossary (P4-9); every method runs in a tenant tx (RLS enforced). */
export class PgRepGlossaryRepository implements RepGlossaryRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(userId: string, wrongTerm: string, rightTerm: string, atMs: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      const at = new Date(atMs);
      await c.query(
        `INSERT INTO rep_glossary (user_id, wrong_term, right_term, times_corrected, first_seen, last_seen)
         VALUES ($1, $2, $3, 1, $4, $4)
         ON CONFLICT (user_id, wrong_term, right_term)
         DO UPDATE SET times_corrected = rep_glossary.times_corrected + 1, last_seen = EXCLUDED.last_seen`,
        [userId, wrongTerm, rightTerm, at],
      );
    });
  }

  async listByUser(userId: string): Promise<RepGlossaryEntry[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT wrong_term, right_term, times_corrected, first_seen, last_seen FROM rep_glossary ORDER BY times_corrected DESC`,
      );
      return (rows as unknown as Row[]).map((r) => ({
        wrongTerm: r.wrong_term,
        rightTerm: r.right_term,
        timesCorrected: r.times_corrected,
        firstSeen: r.first_seen.getTime(),
        lastSeen: r.last_seen.getTime(),
      }));
    });
  }

  async deleteByTerms(userId: string, terms: string[]): Promise<number> {
    const normalised = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (normalised.length === 0) return 0;
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `DELETE FROM rep_glossary WHERE lower(wrong_term) = ANY($1) OR lower(right_term) = ANY($1) RETURNING id`,
        [normalised],
      );
      return rows.length;
    });
  }

  async purgeUser(userId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(`DELETE FROM rep_glossary`);
    });
  }
}
