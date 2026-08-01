import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { MondayDigestService } from '../services/monday/monday-service.js';
import { extractToken, sendJson } from './helpers.js';

export interface MondayRouteDeps {
  auth: AuthService;
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
  sendJson(res, 200, await deps.monday.build(identity.userId, Date.now()));
  return true;
}
