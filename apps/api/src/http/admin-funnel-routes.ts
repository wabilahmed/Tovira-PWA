import type { FunnelPeriod, FunnelSource } from '../services/funnel/funnel.js';
import { FUNNEL_PERIODS, funnelReport } from '../services/funnel/funnel.js';
import { sendJson } from './helpers.js';
import type { AdminDataRoute } from './admin-routes.js';

/**
 * [P63-6 · owner] Admin → Funnel (admin session only; never a rep route).
 *  GET /admin/funnel?period=7d|30d|all   the counts at each step, and one row per lead with each step's date
 */
export function adminFunnelRoute(deps: { source: FunnelSource; now?: () => number }): AdminDataRoute {
  const now = deps.now ?? (() => Date.now());
  return async (req, res, url) => {
    if ((req.method ?? 'GET') !== 'GET' || url.pathname !== '/admin/funnel') return false;
    const period = (url.searchParams.get('period') ?? '30d') as FunnelPeriod;
    if (!FUNNEL_PERIODS.includes(period)) { sendJson(res, 400, { error: 'validation', message: 'period must be 7d, 30d or all.' }); return true; }
    sendJson(res, 200, funnelReport(await deps.source.people(), period, now()));
    return true;
  };
}
