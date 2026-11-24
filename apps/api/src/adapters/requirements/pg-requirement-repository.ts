import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import { groupByClient } from '../../services/notes/list-for-clients.js';
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
      if (reqs.length === 0) return [];
      // [P86 · index audit] one INSERT for all of the note's requirements (was one per requirement), returned in
      // input order (ids made here, so the order never depends on RETURNING's).
      const ids = reqs.map(() => randomUUID());
      const { rows } = await c.query(
        `INSERT INTO requirements (id, user_id, note_id, client_id, text, requirement_raw, stated_on, confidence, embedding)
         SELECT t.id, $1, $2, $3, t.text, t.requirement_raw, t.stated_on, t.confidence, t.embedding::vector
           FROM unnest($4::uuid[], $5::text[], $6::text[], $7::date[], $8::text[], $9::text[]) AS t(id, text, requirement_raw, stated_on, confidence, embedding)
         RETURNING ${COLUMNS}`,
        [userId, noteId, clientId, ids, reqs.map((r) => r.text), reqs.map((r) => r.requirementRaw), reqs.map((r) => r.statedOn), reqs.map((r) => r.confidence), reqs.map((r) => vec(r.embedding))],
      );
      const byId = new Map((rows as unknown as Row[]).map((r) => [String(r.id), toRecord(r)]));
      return ids.map((id) => byId.get(id)!);
    });
  }

  async listByClient(userId: string, clientId: string): Promise<RequirementRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM requirements WHERE client_id = $1 ORDER BY created_at DESC`, [clientId]);
      return (rows as unknown as Row[]).map(toRecord);
    });
  }

  /** [P86] Every listed client's requirements in ONE tenant read (was one per client). Same order as listByClient. */
  async listByClients(userId: string, clientIds: string[]): Promise<Map<string, RequirementRecord[]>> {
    if (clientIds.length === 0) return new Map();
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM requirements WHERE client_id = ANY($1::uuid[]) ORDER BY created_at DESC`, [clientIds]);
      return groupByClient((rows as unknown as Row[]).map(toRecord), clientIds);
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

  async reassignByNote(userId: string, noteId: string, toClientId: string): Promise<string[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('UPDATE requirements SET client_id = $1 WHERE note_id = $2 RETURNING id', [toClientId, noteId]);
      return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    });
  }

  async deleteByNote(userId: string, noteId: string): Promise<string[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('DELETE FROM requirements WHERE note_id = $1 RETURNING id', [noteId]);
      return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
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
