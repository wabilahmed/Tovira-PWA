import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { HeroService } from '../services/hero/hero-service.js';
import { PrioritiesService, RefreshLimitError } from '../services/hero/priorities-service.js';
import { groupPriorities } from '../services/hero/group-priorities.js';
import type { BillingService } from '../services/billing/billing-service.js';
import { extractToken, sendJson, requireEntitled } from './helpers.js';

export interface HeroRouteDeps {
  auth: AuthService;
  hero: HeroService;
  priorities: PrioritiesService;
  billing: BillingService;
}

const GET_PATHS = ['/hero/status', '/hero/patterns', '/hero/risk', '/today'];

/** GET /hero/status, /hero/patterns, /hero/risk, /today; POST /today/refresh. */
export async function handleHeroRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HeroRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isGet = method === 'GET' && GET_PATHS.includes(path);
  const isRefresh = method === 'POST' && path === '/today/refresh';
  if (!isGet && !isRefresh) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;
  // Today's register + patterns/risk are premium — a lapsed trial gets a 402.
  if (!(await requireEntitled(deps.billing, userId, res))) return true;
  const now = Date.now();

  if (isRefresh) {
    try {
      const actions = await deps.priorities.refresh(userId, now);
      sendJson(res, 200, { actions, refreshesRemaining: await deps.priorities.refreshesRemaining(userId, now) });
    } catch (err) {
      if (err instanceof RefreshLimitError) {
        sendJson(res, 429, { error: 'rate_limited', message: 'You’ve hit today’s refresh limit — your list updates again tomorrow.' });
      } else throw err;
    }
    return true;
  }

  if (path === '/hero/status') sendJson(res, 200, await deps.hero.status(userId));
  else if (path === '/hero/patterns') sendJson(res, 200, { patterns: await deps.hero.patterns(userId, now) });
  else if (path === '/hero/risk') sendJson(res, 200, { atRisk: await deps.hero.risk(userId, now) });
  // /today serves the PRECOMPUTED cache (cost-guard #3); zero model calls here. [NOTIF-REWORK Task 5]
  // groups carry the analysis by WHY (grouped from the same cached actions + the volume-gated
  // patterns/risk — hero.patterns()/risk() gate thin samples out); `actions` stays for the flat feed.
  else {
    const actions = await deps.priorities.getForToday(userId, now);
    const groups = groupPriorities(actions, await deps.hero.patterns(userId, now), await deps.hero.risk(userId, now));
    sendJson(res, 200, { groups, actions, refreshesRemaining: await deps.priorities.refreshesRemaining(userId, now) });
  }
  return true;
}
