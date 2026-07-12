import type { Pool } from 'pg';
import type {
  ExtractionLogEntry,
  ExtractionLogRecord,
  ExtractionLogRepository,
} from '../../ports/extraction-log-repository.js';
import { withTenant } from '../../db/tenant.js';

interface LogRow {
  id: string;
  user_id: string;
  note_id: string;
  prompt_version: string;
  model: string;
  input: string;
  raw_output: string | null;
  status: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  created_at: Date;
}

function toRecord(row: LogRow): ExtractionLogRecord {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    promptVersion: row.prompt_version,
    model: row.model,
    input: row.input,
    rawOutput: row.raw_output,
    status: row.status,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms,
    createdAt: row.created_at.getTime(),
  };
}

const COLUMNS =
  'id, user_id, note_id, prompt_version, model, input, raw_output, status, input_tokens, output_tokens, latency_ms, created_at';

export class PgExtractionLogRepository implements ExtractionLogRepository {
  constructor(private readonly pool: Pool) {}

  async log(userId: string, entry: ExtractionLogEntry): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO extraction_logs
           (user_id, note_id, prompt_version, model, input, raw_output, status, input_tokens, output_tokens, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId,
          entry.noteId,
          entry.promptVersion,
          entry.model,
          entry.input,
          entry.rawOutput,
          entry.status,
          entry.inputTokens,
          entry.outputTokens,
          entry.latencyMs,
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
}
