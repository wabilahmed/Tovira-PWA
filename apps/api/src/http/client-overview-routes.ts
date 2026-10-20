import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientOverviewService } from '../services/clients/client-overview.js';
import { extractToken, sendJson } from './helpers.js';

export interface ClientOverviewRouteDeps {
  auth: AuthService;
  overview?: ClientOverviewService;
}

const OVERVIEW_RE = /^\/clients\/([^/]+)\/overview$/;

/** [P36-5] GET /clients/:id/overview — the client page's header + section summaries (no model call). */
export async function handleClientOverviewRoute(req: IncomingMessage, res: ServerResponse, deps: ClientOverviewRouteDeps): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') return false;
  const path = (req.url ?? '/').split('?')[0]!;
  const m = OVERVIEW_RE.exec(path);
  const isSuggestions = path === '/clients/status-suggestions';
  if (!m && !isSuggestions) return false;
  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  if (!deps.overview) {
    sendJson(res, 501, { error: 'not_available' });
    return true;
  }
  // [P36-7] GET /clients/status-suggestions — what the inference would change, as suggestions only.
  if (isSuggestions) {
    sendJson(res, 200, { suggestions: await deps.overview.suggestions(identity.userId, Date.now()) });
    return true;
  }
  const out = await deps.overview.forClient(identity.userId, decodeURIComponent(m![1]!), Date.now());
  // [SEC-01] an unknown / another rep's client is a 404, never an empty 200.
  if (!out) sendJson(res, 404, { error: 'not_found' });
  else sendJson(res, 200, out);
  return true;
}
