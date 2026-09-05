import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { Confidence } from '../../services/extraction/types.js';
import type {
  RequirementRepository,
  RequirementRecord,
  RequirementInput,
  RequirementStatus,
  SimilarRequirement,
} from '../../ports/requirement-repository.js';

interface Row {
  id: string;
  user_id: string;
  note_id: string;
  client_id: string;
  text: string;
  requirement_raw: string;
  stated_on: Date | null;
  confidence: string;
  status: string;
  embedded: boolean;
  last_mentioned_at: Date;
  created_at: Date;
}

function toRecord(r: Row): RequirementRecord {
  return {
    id: r.id,
    userId: r.user_id,
    noteId: r.note_id,
    clientId: r.client_id,
    text: r.text,
    requirementRaw: r.requirement_raw,
    statedOn: r.stated_on ? r.stated_on.toISOString().slice(0, 10) : null,
    confidence: r.confidence as Confidence,
    status: r.status as RequirementStatus,
    embedded: r.embedded,
    lastMentionedAt: r.last_mentioned_at.getTime(),
    createdAt: r.created_at.getTime(),
  };
}

// The raw vector never leaves the repo — expose only its presence, like inventory.
const COLUMNS =
  'id, user_id, note_id, client_id, text, requirement_raw, stated_on, confidence, status, (embedding IS NOT NULL) AS embedded, last_mentioned_at, created_at';

const vec = (e: number[] | null): string | null => (e === null ? null : `[${e.join(',')}]`);

export class PgRequirementRepository implements RequirementRepository {
  constructor(private readonly pool: Pool) {}

  async saveForNote(userId: string, noteId: string, clientId: string, reqs: RequirementInput[]): Promise<RequirementRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      await c.query('DELETE FROM requirements WHERE note_id = $1', [noteId]); // idempotent per note
      const out: RequirementRecord[] = [];
      for (const r of reqs) {
        const { rows } = await c.query(
          `INSERT INTO requirements (user_id, note_id, client_id, text, requirement_raw, stated_on, confidence, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector) RETURNING ${COLUMNS}`,
          [userId, noteId, clientId, r.text, r.requirementRaw, r.statedOn, r.confidence, vec(r.embedding)],
        );
        out.push(toRecord(rows[0] as unknown as Row));
      }
      return out;
    });
  }

  async listByClient(userId: string, clientId: string): Promise<RequirementRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM requirements WHERE client_id = $1 ORDER BY created_at DESC`, [clientId]);
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async listOpenByUser(userId: string): Promise<RequirementRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM requirements WHERE user_id = $1 AND status = 'open' ORDER BY created_at DESC`, [userId]);
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  async findByIdForUser(userId: string, id: string): Promise<RequirementRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM requirements WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0] as unknown as Row) : null;
    });
  }

  async setStatus(userId: string, id: string, status: RequirementStatus): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query('UPDATE requirements SET status = $1 WHERE id = $2', [status, id]);
    });
  }

  async markMentioned(userId: string, id: string, at: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      // A fresh mention resets the dormancy clock and revives a dormant need.
      await c.query(
        `UPDATE requirements SET last_mentioned_at = to_timestamp($1 / 1000.0),
           status = CASE WHEN status = 'dormant' THEN 'open' ELSE status END
         WHERE id = $2`,
        [at, id],
      );
    });
  }

  async searchByEmbedding(userId: string, queryEmbedding: number[], limit: number): Promise<SimilarRequirement[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS}, 1 - (embedding <=> $1::vector) AS similarity
         FROM requirements
         WHERE status = 'open' AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector LIMIT $2`,
        [vec(queryEmbedding), limit],
      );
      return (rows as unknown as Array<Row & { similarity: number }>).map((row) => ({ requirement: toRecord(row), similarity: row.similarity }));
    });
  }

  async markDormantBefore(userId: string, cutoffMs: number): Promise<number> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `UPDATE requirements SET status = 'dormant'
         WHERE user_id = $1 AND status = 'open' AND last_mentioned_at < to_timestamp($2 / 1000.0) RETURNING id`,
        [userId, cutoffMs],
      );
      return rows.length;
    });
  }

  async purgeUser(userId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query('DELETE FROM requirements WHERE user_id = $1', [userId]);
    });
  }
}
