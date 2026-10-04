import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { ClientPointerRepository, ClientPointerSet } from '../../ports/client-pointer-repository.js';
import type { Pointer } from '../../services/extraction/types.js';

/**
 * [POINTERS · Task 3] Postgres per-client pointer store (RLS-scoped; one row per client). The pointer
 * array is stored as jsonb — receipts cite messages by verbatim span + timestamp, so there are no
 * message rows to foreign-key to; the FK is to the client (ON DELETE CASCADE). See migration 0084.
 */
interface Row { client_id: string; pointers: Pointer[]; retrospective_disclosure: string | null; updated_at: Date }

function toSet(r: Row): ClientPointerSet {
  return { clientId: r.client_id, pointers: r.pointers ?? [], retrospectiveDisclosure: r.retrospective_disclosure, updatedAt: r.updated_at.getTime() };
}

export class PgClientPointerRepository implements ClientPointerRepository {
  constructor(private readonly pool: Pool) {}

  async getForClient(userId: string, clientId: string): Promise<ClientPointerSet | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('SELECT client_id, pointers, retrospective_disclosure, updated_at FROM client_pointers WHERE client_id = $1', [clientId]);
      return rows.length ? toSet(rows[0] as unknown as Row) : null;
    });
  }

  async save(userId: string, clientId: string, set: { pointers: Pointer[]; retrospectiveDisclosure: string | null }, nowMs: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO client_pointers (user_id, client_id, pointers, retrospective_disclosure, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, to_timestamp($5::double precision / 1000))
         ON CONFLICT (user_id, client_id)
         DO UPDATE SET pointers = EXCLUDED.pointers, retrospective_disclosure = EXCLUDED.retrospective_disclosure, updated_at = EXCLUDED.updated_at`,
        [userId, clientId, JSON.stringify(set.pointers), set.retrospectiveDisclosure, nowMs],
      );
    });
  }

  async deleteForClient(userId: string, clientId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query('DELETE FROM client_pointers WHERE client_id = $1', [clientId]);
    });
  }

  async purgeUser(userId: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query('DELETE FROM client_pointers');
    });
  }

  async listByUser(userId: string): Promise<ClientPointerSet[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query('SELECT client_id, pointers, retrospective_disclosure, updated_at FROM client_pointers ORDER BY updated_at DESC');
      return (rows as unknown as Row[]).map(toSet);
    });
  }
}
