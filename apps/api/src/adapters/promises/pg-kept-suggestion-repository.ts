import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { KeptSuggestionRepository, KeptSuggestionRecord, NewKeptSuggestion, KeptSuggestionStatus } from '../../ports/kept-suggestion-repository.js';

interface Row {
  id: string; user_id: string; client_id: string; note_id: string | null; promise_key: string; promise_owner: 'rep' | 'client';
  promise_text: string; promise_span: string | null; promise_at: string | null; delivery_at: string; delivery_body: string;
  status: KeptSuggestionStatus; created_at: Date; resolved_at: Date | null;
}
const COLS = 'id, user_id, client_id, note_id, promise_key, promise_owner, promise_text, promise_span, promise_at, delivery_at, delivery_body, status, created_at, resolved_at';
const toRecord = (r: Row): KeptSuggestionRecord => ({
  id: r.id, userId: r.user_id, clientId: r.client_id, noteId: r.note_id ?? '', promiseKey: r.promise_key, promiseOwner: r.promise_owner,
  promiseText: r.promise_text, promiseSpan: r.promise_span, promiseAt: r.promise_at, deliveryAt: r.delivery_at, deliveryBody: r.delivery_body,
  status: r.status, createdAt: r.created_at.getTime(), resolvedAt: r.resolved_at ? r.resolved_at.getTime() : null,
});

/** Postgres [P24-2] kept-promise suggestions — RLS-bound (0090); uniqueness is enforced by the table. */
export class PgKeptSuggestionRepository implements KeptSuggestionRepository {
  constructor(private readonly pool: Pool) {}

  async createIfAbsent(userId: string, s: NewKeptSuggestion): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO promise_kept_suggestions (user_id, client_id, note_id, promise_key, promise_owner, promise_text, promise_span, promise_at, delivery_at, delivery_body)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, client_id, promise_key, delivery_at) DO NOTHING RETURNING id`,
        [userId, s.clientId, s.noteId || null, s.promiseKey, s.promiseOwner, s.promiseText, s.promiseSpan, s.promiseAt, s.deliveryAt, s.deliveryBody],
      );
      return rows.length > 0;
    });
  }
  async deliveryTimes(userId: string, clientId: string, promiseKey: string): Promise<Set<string>> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('SELECT delivery_at FROM promise_kept_suggestions WHERE client_id = $1 AND promise_key = $2', [clientId, promiseKey]);
      return new Set((rows as Array<{ delivery_at: string }>).map((r) => r.delivery_at));
    });
  }
  async listOpen(userId: string): Promise<KeptSuggestionRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLS} FROM promise_kept_suggestions WHERE status = 'open' ORDER BY created_at DESC`);
      return (rows as unknown as Row[]).map(toRecord);
    });
  }
  async get(userId: string, id: string): Promise<KeptSuggestionRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLS} FROM promise_kept_suggestions WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0] as unknown as Row) : null;
    });
  }
  async setStatus(userId: string, id: string, status: KeptSuggestionStatus, nowMs: number): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        'UPDATE promise_kept_suggestions SET status = $2, resolved_at = $3 WHERE id = $1 RETURNING id',
        [id, status, status === 'open' ? null : new Date(nowMs)],
      );
      return rows.length > 0;
    });
  }
}
