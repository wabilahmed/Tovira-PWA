import type { Pool } from 'pg';
import type { RecallMessage, RecallRole, RecallSessionExport, RecallSessionRepository } from '../../ports/recall-session-repository.js';
import { withTenant } from '../../db/tenant.js';

interface MsgRow { role: RecallRole; content: string; created_at: Date }
interface SessRow { id: string; created_at: Date }

/** Postgres-backed Ask sessions (RLS-isolated, composite-FK'd — see migration 0044). */
export class PgRecallSessionRepository implements RecallSessionRepository {
  constructor(private readonly pool: Pool) {}

  async activeSession(userId: string, nowMs: number, idleMs: number): Promise<string> {
    return withTenant(this.pool, userId, async (c) => {
      const cutoff = (nowMs - idleMs) / 1000;
      const now = nowMs / 1000;
      const found = await c.query(
        `UPDATE recall_sessions SET last_activity_at = to_timestamp($2)
         WHERE id = (
           SELECT id FROM recall_sessions
           WHERE last_activity_at >= to_timestamp($1)
           ORDER BY last_activity_at DESC LIMIT 1
         ) RETURNING id`,
        [cutoff, now],
      );
      if (found.rows[0]) return (found.rows[0] as { id: string }).id;
      const created = await c.query(
        `INSERT INTO recall_sessions (user_id, created_at, last_activity_at)
         VALUES ($1, to_timestamp($2), to_timestamp($2)) RETURNING id`,
        [userId, now],
      );
      return (created.rows[0] as { id: string }).id;
    });
  }

  async appendMessage(userId: string, sessionId: string, role: RecallRole, content: string, _nowMs: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO recall_messages (user_id, session_id, role, content) VALUES ($1, $2, $3, $4)`,
        [userId, sessionId, role, content],
      );
    });
  }

  async recentMessages(userId: string, sessionId: string, n: number): Promise<RecallMessage[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT role, content, created_at FROM recall_messages
         WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [sessionId, n],
      );
      return (rows as unknown as MsgRow[]).reverse().map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at.getTime() }));
    });
  }

  async purgeUser(userId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query('DELETE FROM recall_sessions WHERE user_id = $1', [userId]); // messages cascade
    });
  }

  async exportForUser(userId: string): Promise<RecallSessionExport[]> {
    return withTenant(this.pool, userId, async (c) => {
      const sessions = await c.query(`SELECT id, created_at FROM recall_sessions ORDER BY created_at`);
      const out: RecallSessionExport[] = [];
      for (const s of sessions.rows as unknown as SessRow[]) {
        const msgs = await c.query(
          `SELECT role, content, created_at FROM recall_messages WHERE session_id = $1 ORDER BY created_at`,
          [s.id],
        );
        out.push({
          id: s.id,
          createdAt: s.created_at.getTime(),
          messages: (msgs.rows as unknown as MsgRow[]).map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at.getTime() })),
        });
      }
      return out;
    });
  }
}
