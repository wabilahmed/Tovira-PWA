import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import type { AuthService } from '../services/auth/auth-service.js';
import { extractToken, sendJson } from './helpers.js';
import { withTenant } from '../db/tenant.js';
import { tallyTier1 } from '../services/redaction/tier1-tally.js';

export interface Tier1ScanDeps {
  auth: AuthService;
  pool: Pool;
}

/**
 * GET /admin/tier1-scan — TEMPORARY one-off compliance count (REMOVE after the count is read).
 * Counts Tier-1 sensitive values in existing PRE-redaction stored notes, using the same
 * Luhn-validating redactor that protects new data. Returns AGGREGATE counts by type only —
 * never a value, never which note. Auth-required. Scans every tenant under its own RLS
 * context (the API role has FORCE RLS), so it stays inside the isolation model.
 */
export async function handleTier1ScanRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: Tier1ScanDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET' || (req.url ?? '/').split('?')[0] !== '/admin/tier1-scan') return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  const { rows: users } = await deps.pool.query('SELECT id FROM users');
  const texts: string[] = [];
  for (const u of users) {
    const rows = await withTenant(deps.pool, String(u.id), async (c) => {
      const r = await c.query('SELECT raw_text, messages FROM notes');
      return r.rows;
    });
    for (const n of rows) {
      const raw = (n.raw_text as string | null) ?? '';
      const msgs = Array.isArray(n.messages) ? (n.messages as Array<Record<string, unknown>>) : [];
      const bodies = msgs.map((m) => String(m['body'] ?? '')).join(' ');
      texts.push(`${raw} ${bodies}`);
    }
  }

  const tally = tallyTier1(texts);
  sendJson(res, 200, { ...tally, usersScanned: users.length });
  return true;
}
