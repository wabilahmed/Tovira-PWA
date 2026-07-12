import type { Pool } from 'pg';
import type {
  CorrectionEntry,
  CorrectionRecord,
  CorrectionRepository,
} from '../../ports/correction-repository.js';
import { withTenant } from '../../db/tenant.js';

interface Row {
  id: string;
  user_id: string;
  note_id: string;
  entity_type: string;
  entity_id: string;
  field: string;
  before_value: string | null;
  after_value: string | null;
  created_at: Date;
}

function toRecord(row: Row): CorrectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    field: row.field,
    before: row.before_value,
    after: row.after_value,
    createdAt: row.created_at.getTime(),
  };
}

export class PgCorrectionRepository implements CorrectionRepository {
  constructor(private readonly pool: Pool) {}

  async record(userId: string, entry: CorrectionEntry): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO corrections (user_id, note_id, entity_type, entity_id, field, before_value, after_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, entry.noteId, entry.entityType, entry.entityId, entry.field, entry.before, entry.after],
      );
    });
  }

  async listByUser(userId: string): Promise<CorrectionRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, user_id, note_id, entity_type, entity_id, field, before_value, after_value, created_at
         FROM corrections WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return (rows as unknown as Row[]).map(toRecord);
    });
  }
}
