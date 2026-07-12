import type { Pool } from 'pg';
import type { FactsRepository, PromiseRecord, PromisePatch, SaveExtractionInput } from '../../ports/facts-repository.js';
import { withTenant } from '../../db/tenant.js';

interface PromiseRow {
  id: string;
  user_id: string;
  note_id: string;
  client_id: string;
  text: string;
  owner: string;
  due_date: Date | null;
  due_raw: string | null;
  confidence: string;
  done: boolean;
  confirmed: boolean;
  created_at: Date;
}

function toRecord(row: PromiseRow): PromiseRecord {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    clientId: row.client_id,
    text: row.text,
    owner: row.owner,
    dueDate: row.due_date ? row.due_date.toISOString().slice(0, 10) : null,
    dueRaw: row.due_raw,
    confidence: row.confidence,
    done: row.done,
    confirmed: row.confirmed,
    createdAt: row.created_at.getTime(),
  };
}

const COLUMNS =
  'id, user_id, note_id, client_id, text, owner, due_date, due_raw, confidence, done, confirmed, created_at';

/** Postgres-backed spine store; every method runs in a tenant tx (RLS enforced). */
export class PgFactsRepository implements FactsRepository {
  constructor(private readonly pool: Pool) {}

  async saveExtraction(userId: string, input: SaveExtractionInput): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      // Idempotent per note: replace this note's promises.
      await c.query('DELETE FROM promises WHERE note_id = $1', [input.noteId]);
      for (const p of input.promises) {
        await c.query(
          `INSERT INTO promises (user_id, note_id, client_id, text, owner, due_date, due_raw, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [userId, input.noteId, input.clientId, p.text, p.owner, p.due_date, p.due_raw, p.confidence],
        );
      }
    });
  }

  async listPromisesByUser(userId: string): Promise<PromiseRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM promises WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return (rows as unknown as PromiseRow[]).map(toRecord);
    });
  }

  async listPromisesByNote(userId: string, noteId: string): Promise<PromiseRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM promises WHERE note_id = $1`, [noteId]);
      return (rows as unknown as PromiseRow[]).map(toRecord);
    });
  }

  async confirmPromise(userId: string, id: string): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('UPDATE promises SET confirmed = true WHERE id = $1 RETURNING id', [id]);
      return rows.length > 0;
    });
  }

  async getPromise(userId: string, id: string): Promise<PromiseRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM promises WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0] as unknown as PromiseRow) : null;
    });
  }

  async updatePromise(userId: string, id: string, patch: PromisePatch): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const cols: Record<string, unknown> = {
        text: patch.text,
        owner: patch.owner,
        due_date: patch.dueDate,
        due_raw: patch.dueRaw,
        confidence: patch.confidence,
        done: patch.done,
      };
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [col, val] of Object.entries(cols)) {
        if (val !== undefined) {
          params.push(val);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if (sets.length === 0) return true;
      params.push(id);
      const { rows } = await c.query(
        `UPDATE promises SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
        params,
      );
      return rows.length > 0;
    });
  }

  async deletePromise(userId: string, id: string): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('DELETE FROM promises WHERE id = $1 RETURNING id', [id]);
      return rows.length > 0;
    });
  }
}
