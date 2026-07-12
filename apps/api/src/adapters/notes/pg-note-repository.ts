import type { Pool } from 'pg';
import type { NewNote, NotePatch, NoteRecord, NoteRepository, NoteSource } from '../../ports/note-repository.js';
import { withTenant } from '../../db/tenant.js';

interface NoteRow {
  id: string;
  user_id: string;
  client_id: string;
  source: string;
  raw_text: string | null;
  audio_key: string | null;
  status: string;
  extracted: unknown | null;
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
    extracted: row.extracted,
    createdAt: row.created_at.getTime(),
  };
}

const COLUMNS = 'id, user_id, client_id, source, raw_text, audio_key, status, extracted, created_at';

/** Postgres-backed note store; every method runs in a tenant tx (RLS enforced). */
export class PgNoteRepository implements NoteRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, note: NewNote): Promise<NoteRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO notes (user_id, client_id, source, raw_text, audio_key, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${COLUMNS}`,
        [userId, note.clientId, note.source, note.rawText, note.audioKey, note.status],
      );
      return toRecord(rows[0] as unknown as NoteRow);
    });
  }

  async listByClient(userId: string, clientId: string): Promise<NoteRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM notes WHERE client_id = $1 ORDER BY created_at DESC`,
        [clientId],
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
      if (patch.extracted !== undefined) {
        params.push(JSON.stringify(patch.extracted));
        sets.push(`extracted = $${params.length}::jsonb`);
      }
      if (patch.embedding !== undefined) {
        params.push(patch.embedding === null ? null : `[${patch.embedding.join(',')}]`);
        sets.push(`embedding = $${params.length}::vector`);
      }
      if (sets.length === 0) return;
      params.push(id);
      await c.query(`UPDATE notes SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    });
  }
}
