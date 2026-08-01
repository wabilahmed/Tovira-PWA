import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BookScanService } from '../services/book-scan/book-scan-service.js';
import { extractToken, sendJson } from './helpers.js';

export interface ShareCardRouteDeps {
  auth: AuthService;
  bookScan: BookScanService;
}

/** GET /share-card — COUNTS ONLY, from the rep's own scan (P5-6). No identifiers. */
export async function handleShareCardRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ShareCardRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET' || (req.url ?? '/').split('?')[0] !== '/share-card') return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  // Only ever the caller's own scan — a card can't be generated from another rep's.
  sendJson(res, 200, await deps.bookScan.shareCard(identity.userId, Date.now()));
  return true;
}
