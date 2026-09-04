import type { Pool } from 'pg';
import type { MeetingRecord, MeetingRepository, MeetingPatch, NewMeeting } from '../../ports/meeting-repository.js';
import { withTenant } from '../../db/tenant.js';

interface Row {
  id: string;
  user_id: string;
  client_id: string;
  datetime: Date | null;
  datetime_raw: string;
  title: string | null;
  confirmed: boolean;
  note_id: string | null;
  nudged_at: Date | null;
  created_at: Date;
}

function toRecord(row: Row): MeetingRecord {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    datetime: row.datetime ? row.datetime.toISOString() : null,
    datetimeRaw: row.datetime_raw,
    title: row.title,
    confirmed: row.confirmed,
    noteId: row.note_id,
    nudgedAt: row.nudged_at ? row.nudged_at.getTime() : null,
    createdAt: row.created_at.getTime(),
  };
}

const COLUMNS = 'id, user_id, client_id, datetime, datetime_raw, title, confirmed, note_id, nudged_at, created_at';

export class PgMeetingRepository implements MeetingRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, meeting: NewMeeting): Promise<MeetingRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO meetings (user_id, client_id, datetime, datetime_raw, title, confirmed, note_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [userId, meeting.clientId, meeting.datetime, meeting.datetimeRaw, meeting.title, meeting.confirmed, meeting.noteId ?? null],
      );
      return toRecord(rows[0] as unknown as Row);
    });
  }

  async update(userId: string, id: string, patch: MeetingPatch): Promise<MeetingRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      // COALESCE keeps a field when the patch omits it (undefined → NULL param → keep existing).
      // nudged_at + confirmed are deliberately not in the SET list.
      const { rows } = await c.query(
        `UPDATE meetings SET
           datetime = CASE WHEN $2::boolean THEN $3::timestamptz ELSE datetime END,
           datetime_raw = COALESCE($4, datetime_raw),
           title = CASE WHEN $5::boolean THEN $6::text ELSE title END
         WHERE id = $1 RETURNING ${COLUMNS}`,
        [
          id,
          patch.datetime !== undefined, patch.datetime ?? null,
          patch.datetimeRaw ?? null,
          patch.title !== undefined, patch.title ?? null,
        ],
      );
      return rows[0] ? toRecord(rows[0] as unknown as Row) : null;
    });
  }

  async findByNoteId(userId: string, noteId: string): Promise<MeetingRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM meetings WHERE note_id = $1`, [noteId]);
      return rows[0] ? toRecord(rows[0] as unknown as Row) : null;
    });
  }

  async reassignByNote(userId: string, noteId: string, toClientId: string): Promise<number> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('UPDATE meetings SET client_id = $1 WHERE note_id = $2 RETURNING id', [toClientId, noteId]);
      return rows.length;
    });
  }

  async deleteByNote(userId: string, noteId: string): Promise<number> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('DELETE FROM meetings WHERE note_id = $1 RETURNING id', [noteId]);
      return rows.length;
    });
  }

  async listUnconfirmedByUser(userId: string): Promise<MeetingRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM meetings WHERE user_id = $1 AND confirmed = false ORDER BY datetime NULLS LAST`,
        [userId],
      );
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async confirm(userId: string, id: string): Promise<MeetingRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `UPDATE meetings SET confirmed = true WHERE id = $1 RETURNING ${COLUMNS}`,
        [id],
      );
      return rows[0] ? toRecord(rows[0] as unknown as Row) : null;
    });
  }

  async listByUser(userId: string): Promise<MeetingRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM meetings WHERE user_id = $1 ORDER BY datetime NULLS LAST`,
        [userId],
      );
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async findByIdForUser(userId: string, id: string): Promise<MeetingRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM meetings WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0] as unknown as Row) : null;
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('DELETE FROM meetings WHERE id = $1 RETURNING id', [id]);
      return rows.length > 0;
    });
  }

  async dueForNudge(userId: string, fromIso: string, toIso: string): Promise<MeetingRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM meetings
         WHERE user_id = $1 AND confirmed = true AND nudged_at IS NULL
           AND datetime IS NOT NULL AND datetime >= $2 AND datetime <= $3`,
        [userId, fromIso, toIso],
      );
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async markNudged(userId: string, id: string, at: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query('UPDATE meetings SET nudged_at = to_timestamp($2 / 1000.0) WHERE id = $1', [id, at]);
    });
  }
}
