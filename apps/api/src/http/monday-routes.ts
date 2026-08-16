import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { MondayDigestService } from '../services/monday/monday-service.js';
import { extractToken, sendJson, requireEntitled } from './helpers.js';

export interface MondayRouteDeps {
  auth: AuthService;
  billing: BillingService;
  monday: MondayDigestService;
}

/** GET /monday-digest — the weekly digest, viewable in-app regardless of push (P3-8). */
export async function handleMondayRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: MondayRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET' || (req.url ?? '/').split('?')[0] !== '/monday-digest') return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  // Entitlement gate (P5-1/P5-2): a lapsed trial gets a calm 402, not the data.
  if (!(await requireEntitled(deps.billing, identity.userId, res))) return true;
  sendJson(res, 200, await deps.monday.build(identity.userId, Date.now()));
  return true;
}
