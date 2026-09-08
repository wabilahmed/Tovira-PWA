import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { ContactAliasRepository, RepNameRepository } from '../../ports/contact-alias-repository.js';

/** RLS-backed client aliases (composite FK to clients; cascades on client/account delete). */
export class PgContactAliasRepository implements ContactAliasRepository {
  constructor(private readonly pool: Pool) {}

  async add(userId: string, clientId: string, alias: string): Promise<void> {
    const a = alias.trim();
    if (!a) return;
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO client_aliases (user_id, client_id, alias) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, client_id, alias) DO NOTHING`,
        [userId, clientId, a],
      );
    });
  }

  async listByClient(userId: string, clientId: string): Promise<string[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT alias FROM client_aliases WHERE user_id = $1 AND client_id = $2`, [userId, clientId]);
      return (rows as Array<{ alias: string }>).map((r) => r.alias);
    });
  }

  async listByUser(userId: string): Promise<Array<{ clientId: string; alias: string }>> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT client_id, alias FROM client_aliases WHERE user_id = $1`, [userId]);
      return (rows as Array<{ client_id: string; alias: string }>).map((r) => ({ clientId: r.client_id, alias: r.alias }));
    });
  }

  async purgeUser(): Promise<void> {
    // PG cascades via the (user_id, client_id) → clients FK on account delete; nothing to do.
  }
}

/** RLS-backed rep WhatsApp name (one row per rep). */
export class PgRepNameRepository implements RepNameRepository {
  constructor(private readonly pool: Pool) {}

  async get(userId: string): Promise<string | null> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(`SELECT whatsapp_name FROM rep_names WHERE user_id = $1`, [userId]);
      return rows[0] ? (rows[0] as { whatsapp_name: string }).whatsapp_name : null;
    });
  }

  async set(userId: string, whatsappName: string): Promise<void> {
    const n = whatsappName.trim();
    if (!n) return;
    await withTenant(this.pool, userId, async (c) => {
      await c.query(
        `INSERT INTO rep_names (user_id, whatsapp_name, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET whatsapp_name = EXCLUDED.whatsapp_name, updated_at = now()`,
        [userId, n],
      );
    });
  }

  async purgeUser(): Promise<void> {
    // PG cascades via the users FK on account delete.
  }
}
