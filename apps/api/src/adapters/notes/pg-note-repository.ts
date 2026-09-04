import type { Pool } from 'pg';
import type { ImportedMessage, MoveSuggestion, NewNote, NotePatch, NoteRecord, NoteRepository, NoteSource, SimilarNote } from '../../ports/note-repository.js';
import { withTenant } from '../../db/tenant.js';

interface NoteRow {
  id: string;
  user_id: string;
  client_id: string;
  source: string;
  raw_text: string | null;
  audio_key: string | null;
  status: string;
  sweep_attempts: number;
  extracted: unknown | null;
  messages: ImportedMessage[] | null;
  move_suggestion: MoveSuggestion | null;
  created_at: Date;
}

function toRecord(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    source: row.source as NoteSource,
    rawText: row.raw_text,
    audioKey: row.audio_key,
    status: row.status,
    sweepAttempts: row.sweep_attempts,
    extracted: row.extracted,
    messages: row.messages,
    moveSuggestion: row.move_suggestion ?? null,
    createdAt: row.created_at.getTime(),
  };
}

const COLUMNS = 'id, user_id, client_id, source, raw_text, audio_key, status, sweep_attempts, extracted, messages, move_suggestion, created_at';

/** Postgres-backed note store; every method runs in a tenant tx (RLS enforced). */
export class PgNoteRepository implements NoteRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, note: NewNote): Promise<NoteRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO notes (user_id, client_id, source, raw_text, audio_key, status, messages)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING ${COLUMNS}`,
        [
          userId,
          note.clientId,
          note.source,
          note.rawText,
          note.audioKey,
          note.status,
          note.messages == null ? null : JSON.stringify(note.messages),
        ],
      );
      return toRecord(rows[0] as unknown as NoteRow);
    });
  }

  async listByClient(userId: string, clientId: string): Promise<NoteRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      // [ASK-CAPTURE] exclude pending-confirmation notes at this single choke point (brief, corpus,
      // Monday, Book Scan, client detail all read here) — an unconfirmed statement never leaks.
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM notes WHERE client_id = $1 AND status <> 'pending_confirmation' ORDER BY created_at DESC`,
        [clientId],
      );
      return (rows as unknown as NoteRow[]).map(toRecord);
    });
  }

  async listPendingByUser(userId: string): Promise<NoteRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM notes WHERE status IN ('pending_transcription', 'pending_extraction') ORDER BY created_at ASC`,
      );
      return (rows as unknown as NoteRow[]).map(toRecord);
    });
  }

  async listByStatusForUser(userId: string, status: string): Promise<NoteRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM notes WHERE status = $1 ORDER BY created_at DESC`,
        [status],
      );
      return (rows as unknown as NoteRow[]).map(toRecord);
    });
  }

  async listMoveSuggestionsByUser(userId: string): Promise<NoteRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM notes WHERE move_suggestion IS NOT NULL AND status <> 'pending_confirmation' ORDER BY created_at DESC`,
      );
      return (rows as unknown as NoteRow[]).map(toRecord);
    });
  }

  async findByIdForUser(userId: string, id: string): Promise<NoteRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM notes WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0] as unknown as NoteRow) : null;
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('DELETE FROM notes WHERE id = $1 RETURNING id', [id]);
      return rows.length > 0;
    });
  }

  async searchSimilar(
    userId: string,
    clientId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<SimilarNote[]> {
    return withTenant(this.pool, userId, async (c) => {
      const vec = `[${queryEmbedding.join(',')}]`;
      const { rows } = await c.query(
        `SELECT ${COLUMNS}, 1 - (embedding <=> $1::vector) AS similarity
         FROM notes
         WHERE client_id = $2 AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [vec, clientId, limit],
      );
      return (rows as unknown as Array<NoteRow & { similarity: number }>).map((row) => ({
        note: toRecord(row),
        similarity: Number(row.similarity),
      }));
    });
  }

  async searchSimilarByUser(userId: string, queryEmbedding: number[], limit: number): Promise<SimilarNote[]> {
    return withTenant(this.pool, userId, async (c) => {
      const vec = `[${queryEmbedding.join(',')}]`;
      const { rows } = await c.query(
        `SELECT ${COLUMNS}, 1 - (embedding <=> $1::vector) AS similarity
         FROM notes
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [vec, limit],
      );
      return (rows as unknown as Array<NoteRow & { similarity: number }>).map((row) => ({
        note: toRecord(row),
        similarity: Number(row.similarity),
      }));
    });
  }

  async update(userId: string, id: string, patch: NotePatch): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.rawText !== undefined) {
        params.push(patch.rawText);
        sets.push(`raw_text = $${params.length}`);
      }
      if (patch.status !== undefined) {
        params.push(patch.status);
        sets.push(`status = $${params.length}`);
      }
      if (patch.sweepAttempts !== undefined) {
        params.push(patch.sweepAttempts);
        sets.push(`sweep_attempts = $${params.length}`);
      }
      if (patch.extracted !== undefined) {
        params.push(JSON.stringify(patch.extracted));
        sets.push(`extracted = $${params.length}::jsonb`);
      }
      if (patch.embedding !== undefined) {
        params.push(patch.embedding === null ? null : `[${patch.embedding.join(',')}]`);
        sets.push(`embedding = $${params.length}::vector`);
      }
      if (patch.messages !== undefined) {
        params.push(patch.messages === null ? null : JSON.stringify(patch.messages));
        sets.push(`messages = $${params.length}::jsonb`);
      }
      if (patch.moveSuggestion !== undefined) {
        params.push(patch.moveSuggestion === null ? null : JSON.stringify(patch.moveSuggestion));
        sets.push(`move_suggestion = $${params.length}::jsonb`);
      }
      if (patch.clientId !== undefined) {
        params.push(patch.clientId);
        sets.push(`client_id = $${params.length}`);
      }
      if (sets.length === 0) return;
      params.push(id);
      await c.query(`UPDATE notes SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    });
  }
}
