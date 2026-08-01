import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { CorpusStatsService } from '../services/corpus/corpus-service.js';
import { extractToken, sendJson } from './helpers.js';

export interface CorpusRouteDeps {
  auth: AuthService;
  corpus: CorpusStatsService;
}

/** GET /corpus-stats — "X months, Y moments" the rep has built up (P4-10). */
export async function handleCorpusRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CorpusRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET' || (req.url ?? '/').split('?')[0] !== '/corpus-stats') return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  sendJson(res, 200, await deps.corpus.compute(identity.userId));
  return true;
}
