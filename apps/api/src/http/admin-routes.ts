import type { IncomingMessage, ServerResponse } from 'node:http';
import { AdminAuthError, type AdminAuthService, ADMIN_SESSION_IDLE_MS } from '../services/admin/admin-auth-service.js';
import type { AdminStore, AdminUser } from '../ports/admin.js';
import { FixedWindowRateLimiter } from '../services/security/rate-limiter.js';
import { BadJsonError, clientIp, parseCookies, readJsonBody, sendJson } from './helpers.js';

/**
 * [P45-1 · owner] The admin API, under /admin/ (served at /api/admin/…). Admin auth is COOKIE-ONLY (`admin_session`,
 * HttpOnly, SameSite=Strict, path /api/admin) and lives in its own store: a rep session is never an admin session,
 * and an admin session is never a rep session (no rep route reads this cookie). Every route except the sign-in steps
 * needs a session that has completed 2FA. Writes need a JSON body (no cross-site form posts).
 *
 *  POST /admin/auth/login            { email, password }      → { stage }
 *  POST /admin/auth/set-password     { token, password }      → { stage: 'enrol_required' }
 *  POST /admin/auth/enrol/start                               → { secret, otpauthUrl }
 *  POST /admin/auth/enrol/confirm    { code }                 → { recoveryCodes }  (shown once)
 *  POST /admin/auth/mfa              { code }                 → { stage: 'ok' }
 *  POST /admin/auth/logout
 *  GET  /admin/auth/me                                        → { email, stage }
 *  GET  /admin/audit                                          → { entries }
 *  …plus the console's data routes (access requests, costs, leads), registered by `extra`.
 */
export const ADMIN_COOKIE = 'admin_session';

export interface AdminContext { admin: AdminUser; audit: (action: string, target?: string | null, detail?: Record<string, unknown> | null) => Promise<void> }
export type AdminDataRoute = (req: IncomingMessage, res: ServerResponse, url: URL, ctx: AdminContext) => Promise<boolean>;

export interface AdminRouteDeps {
  auth: AdminAuthService;
  store: AdminStore;
  cookieSecure: boolean;
  /** The console's data routes; each returns true when it handled the request. */
  extra?: AdminDataRoute[];
  /** Sign-in attempts (login, 2FA): 10 per 15 minutes per IP and step. */
  limiter?: FixedWindowRateLimiter;
  now?: () => number;
}

export const newAdminLimiter = (): FixedWindowRateLimiter => new FixedWindowRateLimiter(10, 15 * 60_000);
const fallbackLimiter = newAdminLimiter();


function cookie(token: string, secure: boolean, maxAgeSec: number): string {
  const attrs = ['Path=/api/admin', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (secure) attrs.push('Secure');
  return `${ADMIN_COOKIE}=${token}; ${attrs.join('; ')}`;
}
const tokenOf = (req: IncomingMessage): string => parseCookies(req.headers.cookie)[ADMIN_COOKIE] ?? '';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new BadJsonError('JSON body required');
  return ((await readJsonBody(req)) ?? {}) as Record<string, unknown>;
}

export async function handleAdminRoute(req: IncomingMessage, res: ServerResponse, deps: AdminRouteDeps): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://local');
  if (!url.pathname.startsWith('/admin/')) return false;
  const method = req.method ?? 'GET';
  const now = deps.now ?? (() => Date.now());
  const ip = clientIp(req);
  const limiter = deps.limiter ?? fallbackLimiter;

  try {
    // ── Sign-in steps (no completed session needed) ──
    if (method === 'POST' && (url.pathname === '/admin/auth/login' || url.pathname === '/admin/auth/mfa')) {
      const key = `${url.pathname}|${ip}`;
      if (limiter.check(key, now()).limited) { sendJson(res, 429, { error: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' }); return true; }
      limiter.record(key, now());
    }
    if (method === 'POST' && url.pathname === '/admin/auth/login') {
      const b = await body(req);
      const { token } = await deps.auth.login(String(b.email ?? ''), String(b.password ?? ''));
      sendJson(res, 200, { stage: await deps.auth.stage(token) }, { 'set-cookie': cookie(token, deps.cookieSecure, ADMIN_SESSION_IDLE_MS / 1000) });
      return true;
    }
    if (method === 'POST' && url.pathname === '/admin/auth/set-password') {
      const b = await body(req);
      const { token } = await deps.auth.setPassword(String(b.token ?? ''), String(b.password ?? ''));
      sendJson(res, 200, { stage: 'enrol_required' }, { 'set-cookie': cookie(token, deps.cookieSecure, ADMIN_SESSION_IDLE_MS / 1000) });
      return true;
    }
    if (method === 'POST' && url.pathname === '/admin/auth/logout') {
      await deps.auth.logout(tokenOf(req));
      sendJson(res, 200, { ok: true }, { 'set-cookie': cookie('', deps.cookieSecure, 0) });
      return true;
    }

    const token = tokenOf(req);
    const session = await deps.auth.session(token);
    if (!session) { sendJson(res, 401, { error: 'unauthorized' }); return true; }
    const refresh = { 'set-cookie': cookie(token, deps.cookieSecure, ADMIN_SESSION_IDLE_MS / 1000) };

    if (method === 'GET' && url.pathname === '/admin/auth/me') { sendJson(res, 200, { email: session.admin.email, stage: session.stage }, refresh); return true; }
    if (method === 'POST' && url.pathname === '/admin/auth/enrol/start') { sendJson(res, 200, await deps.auth.enrolStart(token), refresh); return true; }
    if (method === 'POST' && url.pathname === '/admin/auth/enrol/confirm') { const b = await body(req); sendJson(res, 200, await deps.auth.enrolConfirm(token, String(b.code ?? '')), refresh); return true; }
    if (method === 'POST' && url.pathname === '/admin/auth/mfa') { const b = await body(req); await deps.auth.verifyMfa(token, String(b.code ?? '')); sendJson(res, 200, { stage: 'ok' }, refresh); return true; }

    // ── Everything else: a session that has completed 2FA ──
    if (session.stage !== 'ok') { sendJson(res, 403, { error: session.stage, message: 'Finish two-factor sign-in first.' }); return true; }
    const ctx: AdminContext = {
      admin: session.admin,
      audit: (action, target = null, detail = null) => deps.store.audit({ adminEmail: session.admin.email, action, target, detail, at: now() }),
    };
    if (method === 'GET' && url.pathname === '/admin/audit') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));
      sendJson(res, 200, { entries: await deps.store.listAudit(limit) }, refresh);
      return true;
    }
    for (const route of deps.extra ?? []) if (await route(req, res, url, ctx)) return true;
    sendJson(res, 404, { error: 'not_found' });
    return true;
  } catch (err) {
    if (err instanceof AdminAuthError) {
      const status = err.code === 'forbidden' ? 403 : err.code === 'weak_password' ? 400 : 401;
      sendJson(res, status, { error: err.code, message: err.message });
      return true;
    }
    if (err instanceof BadJsonError) { sendJson(res, 400, { error: 'bad_request', message: 'Send a JSON body.' }); return true; }
    throw err;
  }
}
