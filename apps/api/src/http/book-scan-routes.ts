import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { BookScanService } from '../services/book-scan/book-scan-service.js';
import { extractToken, sendJson, requireEntitled } from './helpers.js';

export interface BookScanRouteDeps {
  auth: AuthService;
  billing: BillingService;
  bookScan: BookScanService;
}

/** GET /book-scan — the Day-One Book Scan report for the authed rep (P5-3b). */
export async function handleBookScanRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BookScanRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') return false;
  const path = (req.url ?? '/').split('?')[0];
  if (path !== '/book-scan') return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  // Entitlement gate (P5-1/P5-2): a lapsed trial gets a calm 402, not the data.
  if (!(await requireEntitled(deps.billing, identity.userId, res))) return true;
  sendJson(res, 200, await deps.bookScan.scan(identity.userId, Date.now()));
  return true;
}
