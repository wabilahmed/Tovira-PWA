import type { Pool } from 'pg';

/**
 * [P86 · index audit] Which reps have a note in flight, across every tenant, in ONE query (owner pool: the sweep is
 * a cross-tenant job, like the nightly hard-delete). In flight = waiting for transcription or extraction, or claimed
 * for extraction longer ago than the reclaim timeout (a worker that crashed; the sweep reclaims it). Served by the
 * partial index notes_user_in_flight_idx (migration 0120), which holds only notes still in flight.
 */
export class PgNoteSweepSource {
  constructor(private readonly ownerPool: Pool) {}

  async usersWithWork(nowMs: number, staleMs: number): Promise<string[]> {
    const { rows } = await this.ownerPool.query(
      `SELECT DISTINCT user_id FROM notes
        WHERE status IN ('pending_transcription', 'pending_extraction')
           OR (status = 'extracting' AND claimed_at <= to_timestamp($1::double precision / 1000))`,
      [nowMs - staleMs],
    );
    return rows.map((r) => String(r.user_id));
  }
}
