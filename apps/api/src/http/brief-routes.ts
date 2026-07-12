import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BriefService } from '../services/brief/brief-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import { extractToken, sendJson } from './helpers.js';

export interface BriefRouteDeps {
  auth: AuthService;
  brief: BriefService;
  billing: BillingService;
}

const BRIEF_RE = /^\/clients\/([^/]+)\/brief$/;

/** Handle GET /clients/:id/brief. Returns true if handled. */
export async function handleBriefRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BriefRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') return false;
  const match = BRIEF_RE.exec((req.url ?? '/').split('?')[0]!);
  if (!match) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  // [P5-1] The brief is a paid feature — locked once the trial ends unpaid.
  const entitlement = await deps.billing.entitlement(identity.userId, Date.now());
  if (!entitlement.entitled) {
    sendJson(res, 402, { error: 'payment_required', status: entitlement.status });
    return true;
  }
  const brief = await deps.brief.buildBrief(identity.userId, decodeURIComponent(match[1]!));
  if (!brief) {
    sendJson(res, 404, { error: 'not_found' });
    return true;
  }
  sendJson(res, 200, brief);
  return true;
}
