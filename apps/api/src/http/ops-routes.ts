import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { sendJson, readJsonBody, BadJsonError } from './helpers.js';
import type { SpendOverrideRepository } from '../ports/spend-override-repository.js';

export interface OpsRouteDeps {
  /** Unset → the ops routes are disabled (always 403). Never a rep credential. */
  opsToken?: string;
  overrides: SpendOverrideRepository;
  spend: { status(userId: string): Promise<{ periodKey: string; spentAed: number; capAed: number; state: string }> };
}

/** Constant-time ops-token check (never leak validity via timing). Shared with the /health split so
 *  the identifying half of the health body is gated by exactly the same credential (HEALTH-LEAK). */
export function opsTokenOk(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * [SPEND-CAP · CAP-OVERRIDE] Ops-only endpoints. There is no admin auth in the product (Identity is
 * just a userId), so these are gated by an env OPS_TOKEN — NOT a rep session — and the write runs on
 * the superuser pool (an ops action, cross-tenant). A rep, however crafted their request, has no
 * token and cannot raise their own cap or release their own queue: this is not a client capability.
 *
 * POST /ops/spend-cap/override  { userId, capAed, reason, raisedBy? }
 *   Raises the cap for a rep's CURRENT period (audited). The rep is then under cap, so the sweep
 *   drains their queued extraction on its next pass — releasing work, never discarding it.
 * GET  /ops/spend-cap/audit
 *   The override audit trail (who, when, what value, why).
 */
export async function handleOpsRoute(req: IncomingMessage, res: ServerResponse, deps: OpsRouteDeps): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0]!;
  if (!url.startsWith('/ops/')) return false; // not an ops route

  // Ops auth — a single token, constant-time compared. No token configured → disabled.
  const provided = req.headers['x-ops-token'];
  if (!opsTokenOk(typeof provided === 'string' ? provided : undefined, deps.opsToken)) {
    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }

  if (req.method === 'POST' && url === '/ops/spend-cap/override') {
    let body: { userId?: unknown; capAed?: unknown; reason?: unknown; raisedBy?: unknown };
    try {
      body = (await readJsonBody(req)) as typeof body;
    } catch (err) {
      sendJson(res, err instanceof BadJsonError ? 400 : 500, { error: 'bad_request' });
      return true;
    }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const capAed = typeof body.capAed === 'number' ? body.capAed : NaN;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const raisedBy = typeof body.raisedBy === 'string' && body.raisedBy.trim() ? body.raisedBy.trim() : 'ops';
    if (!userId || !reason || !(capAed > 0)) {
      sendJson(res, 400, { error: 'validation', message: 'userId, a positive capAed, and a reason are required.' });
      return true;
    }
    const status = await deps.spend.status(userId); // the CURRENT period the override applies to
    const override = await deps.overrides.set({ userId, periodKey: status.periodKey, capAed, raisedBy, reason });
    // The rep is now under cap → the sweep releases their queued extraction on its next pass.
    sendJson(res, 200, { override, spend: await deps.spend.status(userId) });
    return true;
  }

  if (req.method === 'GET' && url === '/ops/spend-cap/audit') {
    sendJson(res, 200, { audit: await deps.overrides.listAudit(50) });
    return true;
  }

  sendJson(res, 404, { error: 'not_found' });
  return true;
}
