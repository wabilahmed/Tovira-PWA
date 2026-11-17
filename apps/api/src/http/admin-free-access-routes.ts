import type { BillingService } from '../services/billing/billing-service.js';
import type { UserRepository } from '../ports/user-repository.js';
import { BadJsonError, readJsonBody, sendJson } from './helpers.js';
import type { AdminDataRoute } from './admin-routes.js';

/**
 * [P72-2 · owner] Admin → "Give free access": the account is paid until revoked, with no Stripe subscription behind
 * it. Any existing account, by email. Every grant and revoke is written to the admin audit log.
 *
 *  GET  /admin/free-access                       → { accounts: [{ email, since, by }] }
 *  POST /admin/free-access         { email }     → { account }   404 when no account uses that email
 *  POST /admin/free-access/revoke  { email }     → { ok: true }  404 when no account uses that email
 */
export interface FreeAccessRouteDeps {
  billing: Pick<BillingService, 'grantFreeAccess' | 'revokeFreeAccess' | 'listFreeAccess'>;
  users: Pick<UserRepository, 'findByEmail' | 'findById'>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO_ACCOUNT = 'No account uses that email.';

export function adminFreeAccessRoute(deps: FreeAccessRouteDeps): AdminDataRoute {
  const list = async () => {
    const rows = await deps.billing.listFreeAccess();
    const out: Array<{ email: string; since: number; by: string }> = [];
    for (const r of rows) {
      const u = await deps.users.findById(r.userId);
      if (u) out.push({ email: u.email, since: r.since, by: r.by });
    }
    return out;
  };
  return async (req, res, url, ctx) => {
    const p = url.pathname;
    if (p !== '/admin/free-access' && p !== '/admin/free-access/revoke') return false;
    const method = req.method ?? 'GET';
    if (method === 'GET' && p === '/admin/free-access') {
      sendJson(res, 200, { accounts: await list() });
      return true;
    }
    if (method !== 'POST') return false;
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) { sendJson(res, 400, { error: 'validation', message: 'JSON body required.' }); return true; }
    const body = (await readJsonBody(req).catch((e) => { if (e instanceof BadJsonError) return {}; throw e; })) as { email?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email)) { sendJson(res, 400, { error: 'validation', message: 'Enter the email of an existing account.' }); return true; }
    const user = await deps.users.findByEmail(email);
    if (!user) { sendJson(res, 404, { error: 'not_found', message: NO_ACCOUNT }); return true; }
    if (p === '/admin/free-access') {
      await deps.billing.grantFreeAccess(user.id, ctx.admin.email);
      await ctx.audit('free_access.grant', user.email, null);
      const account = (await list()).find((a) => a.email === user.email)!;
      sendJson(res, 200, { account });
      return true;
    }
    await deps.billing.revokeFreeAccess(user.id);
    await ctx.audit('free_access.revoke', user.email, null);
    sendJson(res, 200, { ok: true });
    return true;
  };
}
