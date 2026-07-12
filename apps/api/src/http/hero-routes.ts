import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { HeroService } from '../services/hero/hero-service.js';
import { extractToken, sendJson } from './helpers.js';

export interface HeroRouteDeps {
  auth: AuthService;
  hero: HeroService;
}

/** GET /hero/status, /hero/patterns, /hero/risk, /today. */
export async function handleHeroRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HeroRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') return false;
  const path = (req.url ?? '/').split('?')[0];
  if (!['/hero/status', '/hero/patterns', '/hero/risk', '/today'].includes(path!)) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;
  const now = Date.now();

  if (path === '/hero/status') sendJson(res, 200, await deps.hero.status(userId));
  else if (path === '/hero/patterns') sendJson(res, 200, { patterns: await deps.hero.patterns(userId, now) });
  else if (path === '/hero/risk') sendJson(res, 200, { atRisk: await deps.hero.risk(userId, now) });
  else sendJson(res, 200, { actions: await deps.hero.today(userId, now) });
  return true;
}
