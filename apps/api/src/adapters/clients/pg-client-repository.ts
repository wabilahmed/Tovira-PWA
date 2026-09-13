import type { Pool } from 'pg';
import type { ClientRecord, ClientRepository, ClientOutcome, OutcomeSource, OutcomeTransition } from '../../ports/client-repository.js';
import type { TenantQueryable } from '../../db/tenant.js';
import { withTenant } from '../../db/tenant.js';

interface ClientRow {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  title: string | null;
  email: string | null;
  created_at: Date;
  last_touched_at: Date;
  outcome: ClientOutcome;
  outcome_changed_at: Date | null;
  outcome_source: OutcomeSource | null;
}

function toRecord(row: ClientRow): ClientRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    phone: row.phone,
    title: row.title,
    email: row.email,
    createdAt: row.created_at.getTime(),
    lastTouchedAt: row.last_touched_at.getTime(),
    outcome: row.outcome,
    outcomeChangedAt: row.outcome_changed_at ? row.outcome_changed_at.getTime() : null,
    outcomeSource: row.outcome_source,
  };
}

const COLUMNS = 'id, user_id, name, phone, title, email, created_at, last_touched_at, outcome, outcome_changed_at, outcome_source';

/**
 * Postgres-backed client store. Every method runs inside a tenant transaction
 * (RLS enforced by the non-superuser connection). App-layer `WHERE user_id`
 * filters are defense in depth; RLS is the hard safety net.
 */
export class PgClientRepository implements ClientRepository {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, name: string, phone: string | null = null, title: string | null = null, email: string | null = null): Promise<ClientRecord> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO clients (user_id, name, phone, title, email) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
        [userId, name, phone, title, email],
      );
      return toRecord(rows[0] as unknown as ClientRow);
    });
  }

  async setPhone(userId: string, id: string, phone: string | null): Promise<void> {
    // RLS scopes the row to the owner; a mismatched tenant simply updates nothing.
    await withTenant(this.pool, userId, async (c) => {
      await c.query('UPDATE clients SET phone = $2 WHERE id = $1', [id, phone]);
    });
  }

  async listByUser(userId: string): Promise<ClientRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM clients WHERE user_id = $1 ORDER BY last_touched_at DESC, created_at DESC`,
        [userId],
      );
      return (rows as unknown as ClientRow[]).map(toRecord);
    });
  }

  async search(userId: string, query: string): Promise<ClientRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM clients
         WHERE user_id = $1 AND name ILIKE $2
         ORDER BY last_touched_at DESC, created_at DESC`,
        [userId, `%${query}%`],
      );
      return (rows as unknown as ClientRow[]).map(toRecord);
    });
  }

  async findByIdForUser(userId: string, id: string): Promise<ClientRecord | null> {
    return withTenant(this.pool, userId, async (c) => {
      // No user_id filter here on purpose — RLS alone must scope this row.
      const { rows } = await c.query(`SELECT ${COLUMNS} FROM clients WHERE id = $1`, [id]);
      return rows[0] ? toRecord(rows[0] as unknown as ClientRow) : null;
    });
  }

  async touch(userId: string, id: string): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query('UPDATE clients SET last_touched_at = now() WHERE id = $1', [id]);
    });
  }

  async setLastTouched(userId: string, id: string, ms: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      await c.query('UPDATE clients SET last_touched_at = to_timestamp($2 / 1000.0) WHERE id = $1', [id, ms]);
    });
  }

  async listGoingCold(userId: string, cutoffMs: number): Promise<ClientRecord[]> {
    return withTenant(this.pool, userId, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLUMNS} FROM clients
         WHERE user_id = $1 AND last_touched_at < to_timestamp($2 / 1000.0)
         ORDER BY last_touched_at ASC`,
        [userId, cutoffMs],
      );
      return (rows as unknown as ClientRow[]).map(toRecord);
    });
  }

  async setOutcome(userId: string, id: string, outcome: ClientOutcome, source: OutcomeSource, changedAtMs: number): Promise<void> {
    // RLS scopes the row to the owner; a mismatched tenant simply updates nothing. The UPDATE and the
    // history append run in ONE tenant transaction (withTenant BEGIN/COMMIT), so a transition is never
    // recorded without its state change, nor lost after it.
    await withTenant(this.pool, userId, async (c) => {
      const prev = await prevOutcome(c, id);
      const { rowCount } = (await c.query(
        'UPDATE clients SET outcome = $2, outcome_source = $3, outcome_changed_at = to_timestamp($4 / 1000.0) WHERE id = $1',
        [id, outcome, source, changedAtMs],
      )) as unknown as { rowCount: number };
      if (rowCount && prev !== null && prev !== outcome) {
        await appendHistory(c, userId, id, prev, outcome, source, changedAtMs);
      }
    });
  }

  async clearOutcome(userId: string, id: string, actor: OutcomeSource, changedAtMs: number): Promise<void> {
    await withTenant(this.pool, userId, async (c) => {
      const prev = await prevOutcome(c, id);
      const { rowCount } = (await c.query(
        "UPDATE clients SET outcome = 'open', outcome_source = NULL, outcome_changed_at = NULL WHERE id = $1",
        [id],
      )) as unknown as { rowCount: number };
      if (rowCount && prev !== null && prev !== 'open') {
        await appendHistory(c, userId, id, prev, 'open', actor, changedAtMs);
      }
    });
  }

  async listOutcomeHistory(userId: string, id: string): Promise<OutcomeTransition[]> {
    return withTenant(this.pool, userId, async (c) => {
      // RLS scopes rows to the owner; the client_id filter narrows to one client, oldest first.
      const { rows } = await c.query(
        'SELECT client_id, prev_outcome, new_outcome, source, changed_at FROM client_outcome_history WHERE client_id = $1 ORDER BY changed_at ASC, id ASC',
        [id],
      );
      return (rows as unknown as OutcomeHistoryRow[]).map((r) => ({
        clientId: r.client_id,
        previous: r.prev_outcome,
        next: r.new_outcome,
        source: r.source,
        changedAt: r.changed_at.getTime(),
      }));
    });
  }
}

interface OutcomeHistoryRow {
  client_id: string;
  prev_outcome: ClientOutcome;
  new_outcome: ClientOutcome;
  source: OutcomeSource;
  changed_at: Date;
}

/** Read a client's current outcome inside the tenant tx; null if the row is not visible (foreign/unknown). */
async function prevOutcome(c: TenantQueryable, id: string): Promise<ClientOutcome | null> {
  const { rows } = await c.query('SELECT outcome FROM clients WHERE id = $1', [id]);
  return rows[0] ? (rows[0].outcome as ClientOutcome) : null;
}

/** Append one append-only transition row (INSERT only; the table grants no UPDATE/DELETE). */
async function appendHistory(
  c: TenantQueryable,
  userId: string,
  clientId: string,
  prev: ClientOutcome,
  next: ClientOutcome,
  source: OutcomeSource,
  changedAtMs: number,
): Promise<void> {
  await c.query(
    `INSERT INTO client_outcome_history (user_id, client_id, prev_outcome, new_outcome, source, changed_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))`,
    [userId, clientId, prev, next, source, changedAtMs],
  );
}
