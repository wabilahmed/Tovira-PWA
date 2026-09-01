import type { Pool } from 'pg';
import { promiseDedupeKey } from './dedupe.js';
import type {
  FactsRepository,
  PromiseRecord,
  PromisePatch,
  KeyDateRecord,
  SaveExtractionInput,
} from '../../ports/facts-repository.js';
import { withTenant } from '../../db/tenant.js';

interface KeyDateRow {
  id: string;
  user_id: string;
  note_id: string;
  client_id: string;
  description: string;
  date: Date | null;
  date_raw: string | null;
  type: string;
  created_at: Date;
}

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
  done_at: Date | null;
  confirmed: boolean;
  merged_into: string | null;
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
    doneAt: row.done_at ? row.done_at.getTime() : null,
    confirmed: row.confirmed,
    mergedInto: row.merged_into,
    createdAt: row.created_at.getTime(),
  };
}

const COLUMNS =
  'id, user_id, note_id, client_id, text, owner, due_date, due_raw, confidence, done, done_at, confirmed, merged_into, created_at';

/** Postgres-backed spine store; every method runs in a tenant tx (RLS enforced). */
export class PgFactsRepository implements FactsRepository {
  constructor(private readonly pool: Pool) {}

  async saveExtraction(userId: string, input: SaveExtractionInput): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      // Idempotent per note: replace this note's spine rows. The self-FK
      // (merged_into … ON DELETE SET NULL, migration 0040) promotes any child of a
      // removed canonical back to a canonical automatically.
      await c.query('DELETE FROM promises WHERE note_id = $1', [input.noteId]);
      await c.query('DELETE FROM key_dates WHERE note_id = $1', [input.noteId]);
      // Load this client's OPEN canonicals for strict write-time dedup (B2-9).
      const { rows: openRows } = await c.query(
        'SELECT id, owner, text, due_date FROM promises WHERE client_id = $1 AND merged_into IS NULL AND done = false',
        [input.clientId],
      );
      const canonicalByKey = new Map<string, { id: string; dueDate: Date | null }>();
      for (const r of openRows as { id: string; owner: string; text: string; due_date: Date | null }[]) {
        canonicalByKey.set(promiseDedupeKey(r.owner, r.text), { id: r.id, dueDate: r.due_date });
      }
      for (const p of input.promises) {
        const key = promiseDedupeKey(p.owner, p.text);
        const canonical = canonicalByKey.get(key);
        const { rows: ins } = await c.query(
          `INSERT INTO promises (user_id, note_id, client_id, text, owner, due_date, due_raw, confidence, merged_into)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [userId, input.noteId, input.clientId, p.text, p.owner, p.due_date, p.due_raw, p.confidence, canonical ? canonical.id : null],
        );
        if (canonical) {
          // Specific date wins: fill the canonical's null date from this duplicate.
          if (canonical.dueDate === null && p.due_date !== null) {
            await c.query('UPDATE promises SET due_date = $1, due_raw = $2 WHERE id = $3', [p.due_date, p.due_raw, canonical.id]);
            canonical.dueDate = new Date(p.due_date);
          }
        } else {
          // A new canonical this same note's later promises can also dedup against.
          canonicalByKey.set(key, { id: (ins as { id: string }[])[0]!.id, dueDate: p.due_date ? new Date(p.due_date) : null });
        }
      }
      for (const d of input.keyDates ?? []) {
        await c.query(
          `INSERT INTO key_dates (user_id, note_id, client_id, description, date, date_raw, type)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, input.noteId, input.clientId, d.description, d.date, d.date_raw, d.type],
        );
      }
    });
  }

  async markPromiseDone(userId: string, id: string): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        'UPDATE promises SET done = true, done_at = now() WHERE id = $1 RETURNING id',
        [id],
      );
      return rows.length > 0;
    });
  }

  async listKeyDatesByUser(userId: string): Promise<KeyDateRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, user_id, note_id, client_id, description, date, date_raw, type, created_at
         FROM key_dates WHERE user_id = $1`,
        [userId],
      );
      return (rows as unknown as KeyDateRow[]).map((r) => ({
        id: r.id,
        userId: r.user_id,
        noteId: r.note_id,
        clientId: r.client_id,
        description: r.description,
        date: r.date ? r.date.toISOString().slice(0, 10) : null,
        dateRaw: r.date_raw,
        type: r.type,
        createdAt: r.created_at.getTime(),
      }));
    });
  }

  async listPromisesByUser(userId: string): Promise<PromiseRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM promises WHERE user_id = $1 AND merged_into IS NULL ORDER BY created_at DESC`,
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
