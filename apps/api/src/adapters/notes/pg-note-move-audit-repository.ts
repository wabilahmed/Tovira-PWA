import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { NoteMoveAuditEntry, NoteMoveAuditRepository, NewNoteMoveAudit, NoteMoveCounts } from '../../ports/note-move-audit-repository.js';

interface Row {
  id: string;
  user_id: string;
  note_id: string;
  kind: string;
  from_client_id: string | null;
  to_client_id: string | null;
  counts: NoteMoveCounts;
  occurred_at: Date;
}

function toEntry(r: Row): NoteMoveAuditEntry {
  return {
    id: r.id,
    userId: r.user_id,
    noteId: r.note_id,
    kind: r.kind as 'move' | 'undo',
    fromClientId: r.from_client_id,
    toClientId: r.to_client_id,
    counts: r.counts,
    occurredAt: r.occurred_at.getTime(),
  };
}

const COLUMNS = 'id, user_id, note_id, kind, from_client_id, to_client_id, counts, occurred_at';

export class PgNoteMoveAuditRepository implements NoteMoveAuditRepository {
  constructor(private readonly pool: Pool) {}

  async record(userId: string, entry: NewNoteMoveAudit): Promise<NoteMoveAuditEntry> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO note_move_audit (user_id, note_id, kind, from_client_id, to_client_id, counts)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING ${COLUMNS}`,
        [userId, entry.noteId, entry.kind, entry.fromClientId, entry.toClientId, JSON.stringify(entry.counts)],
      );
      return toEntry(rows[0] as unknown as Row);
    });
  }

  async listByUser(userId: string): Promise<NoteMoveAuditEntry[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM note_move_audit WHERE user_id = $1 ORDER BY occurred_at DESC`, [userId]);
      return (rows as unknown as Row[]).map(toEntry);
    });
  }
}
