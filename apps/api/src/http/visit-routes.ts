import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VisitService } from '../services/visits/visits.js';
import type { RateLimiter } from '../services/security/rate-limiter.js';
import { clientIp, readJsonBody } from './helpers.js';

/**
 * [P63-7 · owner] POST /visit { page, referrer?, utmSource?, utmCampaign? }: a page view from the landing page, request
 * access, sign-in or the privacy page. Public (no session), always 204 with no body, and it never sets a cookie. Bots
 * and signed-in admins are not counted (see VisitService). A per-IP limit stops one browser flooding the counts.
 */
export async function handleVisitRoute(req: IncomingMessage, res: ServerResponse, deps: { visits: VisitService; limiter?: RateLimiter }): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'POST' || (req.url ?? '').split('?')[0] !== '/visit') return false;
  const done = (): void => { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); };
  const ip = clientIp(req);
  if (deps.limiter) {
    if (deps.limiter.check(ip).limited) { done(); return true; }
    deps.limiter.record(ip);
  }
  const body = (await readJsonBody(req).catch(() => null)) as Record<string, unknown> | null;
  if (body && typeof body === 'object') {
    await deps.visits.hit({ page: body.page, referrer: body.referrer, utmSource: body.utmSource, utmCampaign: body.utmCampaign, ip, ua: String(req.headers['user-agent'] ?? '') })
      .catch((e: unknown) => console.warn('[visits] not recorded', e instanceof Error ? e.message : 'error'));
  }
  done();
  return true;
}
