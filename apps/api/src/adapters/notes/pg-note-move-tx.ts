import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { NoteMoveTx, MoveOutcome, UndoOutcome } from '../../ports/note-move-tx.js';
import type { NoteMoveCounts } from '../../ports/note-move-audit-repository.js';

/**
 * Postgres NoteMoveTx (MOVE-ATOMIC, B1). The whole move / undo — every derived row, the note, both
 * clients' last-contact, and the audit insert — runs inside ONE `withTenant` transaction, which
 * BEGINs, COMMITs on success and ROLLBACKs on any error. So a fault partway through leaves nothing
 * changed on either client: a partial move is impossible at the DB. Tenant isolation holds because
 * `withTenant` sets `app.user_id` and RLS + the composite (user_id, client_id) FKs enforce that a
 * note can only move between two clients of the same rep.
 */
export class PgNoteMoveTx implements NoteMoveTx {
  constructor(private readonly pool: Pool) {}

  async move(userId: string, noteId: string, toClientId: string): Promise<MoveOutcome> {
    return withTenant(this.pool, userId, async (c): Promise<MoveOutcome> => {
      const noteRes = await c.query('SELECT client_id, messages FROM notes WHERE id = $1 FOR UPDATE', [noteId]);
      if (noteRes.rows.length === 0) return { ok: false, error: 'note_not_found' };
      const from = (noteRes.rows[0] as { client_id: string }).client_id;
      const messages = (noteRes.rows[0] as { messages: unknown[] | null }).messages;
      if (from === toClientId) return { ok: false, error: 'same_client' };
      const target = await c.query('SELECT 1 FROM clients WHERE id = $1', [toClientId]);
      if (target.rows.length === 0) return { ok: false, error: 'target_not_found' };

      const p = await c.query('UPDATE promises SET client_id = $1 WHERE note_id = $2 RETURNING id', [toClientId, noteId]);
      const k = await c.query('UPDATE key_dates SET client_id = $1 WHERE note_id = $2 RETURNING id', [toClientId, noteId]);
      const m = await c.query('UPDATE meetings SET client_id = $1 WHERE note_id = $2 RETURNING id', [toClientId, noteId]);
      await c.query('UPDATE notes SET client_id = $1, move_suggestion = NULL WHERE id = $2', [toClientId, noteId]);
      // Recompute last-contact on BOTH clients from the notes they now own (created_at is the signal).
      await this.recompute(c, from);
      await this.recompute(c, toClientId);
      const counts: NoteMoveCounts = { messages: Array.isArray(messages) ? messages.length : 0, promises: p.rows.length, keyDates: k.rows.length, meetings: m.rows.length };
      await c.query(
        `INSERT INTO note_move_audit (user_id, note_id, kind, from_client_id, to_client_id, counts)
         VALUES ($1, $2, 'move', $3, $4, $5::jsonb)`,
        [userId, noteId, from, toClientId, JSON.stringify(counts)],
      );
      return { ok: true, fromClientId: from, counts };
    });
  }

  async undo(userId: string, noteId: string): Promise<UndoOutcome> {
    return withTenant(this.pool, userId, async (c): Promise<UndoOutcome> => {
      const noteRes = await c.query('SELECT client_id, messages FROM notes WHERE id = $1 FOR UPDATE', [noteId]);
      if (noteRes.rows.length === 0) return { ok: false, error: 'note_not_found' };
      const from = (noteRes.rows[0] as { client_id: string }).client_id;
      const messages = (noteRes.rows[0] as { messages: unknown[] | null }).messages;
      const p = await c.query('DELETE FROM promises WHERE note_id = $1 RETURNING id', [noteId]);
      const k = await c.query('DELETE FROM key_dates WHERE note_id = $1 RETURNING id', [noteId]);
      const m = await c.query('DELETE FROM meetings WHERE note_id = $1 RETURNING id', [noteId]);
      await c.query('DELETE FROM notes WHERE id = $1', [noteId]); // training log survives (0045, no FK)
      await this.recompute(c, from);
      const counts: NoteMoveCounts = { messages: Array.isArray(messages) ? messages.length : 0, promises: p.rows.length, keyDates: k.rows.length, meetings: m.rows.length };
      await c.query(
        `INSERT INTO note_move_audit (user_id, note_id, kind, from_client_id, to_client_id, counts)
         VALUES ($1, $2, 'undo', $3, NULL, $4::jsonb)`,
        [userId, noteId, from, JSON.stringify(counts)],
      );
      return { ok: true, fromClientId: from, counts };
    });
  }

  private async recompute(c: { query: (q: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }, clientId: string): Promise<void> {
    // last_touched_at = the most recent note's created_at (fallback: the client's own created_at).
    await c.query(
      `UPDATE clients SET last_touched_at = COALESCE(
         (SELECT max(created_at) FROM notes WHERE client_id = $1),
         created_at
       ) WHERE id = $1`,
      [clientId],
    );
  }
}
