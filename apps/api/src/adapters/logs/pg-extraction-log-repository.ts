import type { Pool } from 'pg';
import type {
  ExtractionLogEntry,
  ExtractionLogRecord,
  ExtractionLogRepository,
  RejectionReason,
} from '../../ports/extraction-log-repository.js';
import { withTenant } from '../../db/tenant.js';

interface LogRow {
  id: string;
  user_id: string;
  note_id: string;
  prompt_version: string;
  model: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  facts_proposed: number;
  facts_accepted: number;
  facts_rejected: number;
  rejected_by_reason: Partial<Record<RejectionReason, number>> | null;
  created_at: Date;
}

function toRecord(row: LogRow): ExtractionLogRecord {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    promptVersion: row.prompt_version,
    model: row.model,
    status: row.status,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    factsProposed: row.facts_proposed,
    factsAccepted: row.facts_accepted,
    factsRejected: row.facts_rejected,
    rejectedByReason: row.rejected_by_reason ?? {},
    createdAt: row.created_at.getTime(),
  };
}

const COLUMNS =
  'id, user_id, note_id, prompt_version, model, status, input_tokens, output_tokens, latency_ms, cache_creation_tokens, cache_read_tokens, facts_proposed, facts_accepted, facts_rejected, rejected_by_reason, created_at';

export class PgExtractionLogRepository implements ExtractionLogRepository {
  constructor(private readonly pool: Pool) {}

  async log(userId: string, entry: ExtractionLogEntry): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO extraction_logs
           (user_id, note_id, prompt_version, model, status, input_tokens, output_tokens, latency_ms,
            cache_creation_tokens, cache_read_tokens, facts_proposed, facts_accepted, facts_rejected, rejected_by_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
        [
          userId,
          entry.noteId,
          entry.promptVersion,
          entry.model,
          entry.status,
          entry.inputTokens,
          entry.outputTokens,
          entry.latencyMs,
          entry.cacheCreationTokens ?? 0,
          entry.cacheReadTokens ?? 0,
          entry.factsProposed,
          entry.factsAccepted,
          entry.factsRejected,
          JSON.stringify(entry.rejectedByReason ?? {}),
        ],
      );
    });
  }

  async listByUser(userId: string): Promise<ExtractionLogRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM extraction_logs WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return (rows as unknown as LogRow[]).map(toRecord);
    });
  }

  async findPromptVersionByNote(userId: string, noteId: string): Promise<string | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT prompt_version FROM extraction_logs
         WHERE user_id = $1 AND note_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [userId, noteId],
      );
      const row = (rows as unknown as Array<{ prompt_version: string }>)[0];
      return row ? row.prompt_version : null;
    });
  }

  async labelOutcomeByNote(userId: string, noteId: string, status: string): Promise<number> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `UPDATE extraction_logs SET status = $3 WHERE user_id = $1 AND note_id = $2 RETURNING id`,
        [userId, noteId, status],
      );
      return rows.length;
    });
  }
}
