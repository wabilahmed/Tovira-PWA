import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { NewPersonLinkQuestion, PersonLinkQuestion, PersonLinkRepository, PersonLinkStatus } from '../../ports/person-link-repository.js';

type Row = { id: string; client_id: string; note_id: string | null; person_name: string; person_key: string; quote: string | null; quote_at: string | null; status: PersonLinkStatus; created_at: Date };
const toQ = (r: Row): PersonLinkQuestion => ({ id: r.id, clientId: r.client_id, noteId: r.note_id, personName: r.person_name, personKey: r.person_key, quote: r.quote, quoteAt: r.quote_at, status: r.status, createdAt: new Date(r.created_at).getTime() });
const COLS = 'id, client_id, note_id, person_name, person_key, quote, quote_at, status, created_at';

/** [P50-2] RLS-backed person-link questions (migration 0104). One per (client, person) pair. */
export class PgPersonLinkRepository implements PersonLinkRepository {
  constructor(private readonly pool: Pool) {}

  async askOnce(userId: string, q: NewPersonLinkQuestion): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO person_link_questions (user_id, client_id, note_id, person_name, person_key, quote, quote_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, client_id, person_key) DO NOTHING RETURNING id`,
        [userId, q.clientId, q.noteId, q.personName, q.personKey, q.quote, q.quoteAt],
      );
      return rows.length > 0;
    });
  }

  async listPending(userId: string): Promise<PersonLinkQuestion[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLS} FROM person_link_questions WHERE status = 'pending' ORDER BY created_at DESC`);
      return (rows as Row[]).map(toQ);
    });
  }

  async findById(userId: string, id: string): Promise<PersonLinkQuestion | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLS} FROM person_link_questions WHERE id = $1`, [id]);
      return rows[0] ? toQ(rows[0] as Row) : null;
    });
  }

  async answer(userId: string, id: string, status: 'same' | 'different', atMs: number): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `UPDATE person_link_questions SET status = $2, answered_at = to_timestamp($3 / 1000.0) WHERE id = $1 AND status = 'pending' RETURNING id`,
        [id, status, atMs],
      );
      return rows.length > 0;
    });
  }

  async purgeUser(): Promise<void> {
    // PG cascades via the (user_id, client_id) → clients FK and users(id) on account delete.
  }
}
