import type { Pool } from 'pg';
import type {
  CorrectionEntry,
  CorrectionKind,
  CorrectionRecord,
  CorrectionRepository,
  Verdict,
} from '../../ports/correction-repository.js';
import { withTenant } from '../../db/tenant.js';

interface Row {
  id: string;
  user_id: string;
  note_id: string;
  entity_type: string;
  entity_id: string;
  field: string;
  verdict: string;
  correction_kind: string | null;
  date_delta_days: number | null;
  prompt_version: string | null;
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
    verdict: row.verdict as Verdict,
    correctionKind: row.correction_kind as CorrectionKind | null,
    dateDeltaDays: row.date_delta_days,
    promptVersion: row.prompt_version,
    createdAt: row.created_at.getTime(),
  };
}

const COLS = 'id, user_id, note_id, entity_type, entity_id, field, verdict, correction_kind, date_delta_days, prompt_version, created_at';

export class PgCorrectionRepository implements CorrectionRepository {
  constructor(private readonly pool: Pool) {}

  async record(userId: string, entry: CorrectionEntry): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO corrections (user_id, note_id, entity_type, entity_id, field, verdict, correction_kind, date_delta_days, prompt_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [userId, entry.noteId, entry.entityType, entry.entityId, entry.field, entry.verdict, entry.correctionKind, entry.dateDeltaDays, entry.promptVersion],
      );
    });
  }

  async listByUser(userId: string): Promise<CorrectionRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLS} FROM corrections WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

}
