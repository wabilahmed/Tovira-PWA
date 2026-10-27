import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import { liveNames } from '../services/clients/live-names.js';
import { withClientNames, type HeroService, type TodayAction } from '../services/hero/hero-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import { PrioritiesService, RefreshLimitError } from '../services/hero/priorities-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import { extractToken, sendJson, requireEntitled } from './helpers.js';

export interface HeroRouteDeps {
  auth: AuthService;
  hero: HeroService;
  priorities: PrioritiesService;
  billing: BillingService;
  /** [P34-2] Names for a cached list that predates clientName (optional: absent → served as cached). */
  clients?: Pick<ClientRepository, 'listByUser' | 'listRenamesByUser'>;
  /** [P47] Applies an erasure restriction opened after the cached list was computed. Optional for older wiring. */
  withholdRestricted?: (userId: string, actions: TodayAction[]) => Promise<TodayAction[]>;
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
        sendJson(res, 429, { error: 'rate_limited', message: 'You’ve hit today’s refresh limit. Your list updates again tomorrow.' });
      } else throw err;
    }
    return true;
  }

  if (path === '/hero/status') sendJson(res, 200, await deps.hero.status(userId));
  else if (path === '/hero/patterns') sendJson(res, 200, { patterns: await deps.hero.patterns(userId, now) });
  else if (path === '/hero/risk') sendJson(res, 200, { atRisk: await deps.hero.risk(userId, now) });
  // /today serves the PRECOMPUTED cache (cost-guard #3); zero model calls here. [NOTIF-REWORK Task 5]
  // [AUDIT item 3] The `groups` grouping was computed on every Today load via hero.patterns()+risk(),
  // each a full per-client signals scan — a 400-client rep paid for it on every app open — and the web
  // only ever reads `actions`. Dropped. `actions` (the flat feed) and `refreshesRemaining` are unchanged.
  else {
    const cached = await deps.priorities.getForToday(userId, now);
    // [P34-2] A list cached before clientName existed gets names here (one client list, no model call). [P49] And a list
    // cached before a rename shows the client's current name: in clientName and wherever the old name sits in the text.
    // The receipt quote is never rewritten.
    let named = cached;
    if (deps.clients) {
      const live = await liveNames(deps.clients, userId);
      named = withClientNames(cached, new Map((await deps.clients.listByUser(userId)).map((c) => [c.id, c.name]))).map((a) => (a.clientId ? {
        ...a,
        clientName: live.name(a.clientId) ?? a.clientName,
        text: live.rewrite(a.clientId, a.text),
        ...(a.title !== undefined && a.title !== null ? { title: live.rewrite(a.clientId, a.title) } : {}),
        ...(a.subline ? { subline: live.rewrite(a.clientId, a.subline) } : {}),
      } : a));
    }
    // [P47] the list may predate an erasure restriction: apply it now
    const actions = deps.withholdRestricted ? await deps.withholdRestricted(userId, named) : named;
    sendJson(res, 200, { actions, refreshesRemaining: await deps.priorities.refreshesRemaining(userId, now) });
  }
  return true;
}
