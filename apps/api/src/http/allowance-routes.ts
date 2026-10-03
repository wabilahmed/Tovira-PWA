import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { AllowanceStatusService } from '../services/spend/allowance-status.js';
import { extractToken, sendJson } from './helpers.js';
import { TOP_UP_OPTIONS } from '../config.js';

export interface AllowanceRouteDeps {
  auth: AuthService;
  allowanceStatus?: AllowanceStatusService;
  billing?: BillingService;
}

/**
 * [USAGE-ALLOWANCE · D3/D8/D9/D10] GET /allowance/status — the ONE thing the meter needs: a percentage
 * (rounded down, never 100% until AI has stopped), whether AI is paused, when it resets, and — only for
 * a subscribed account (D10: no top-ups in trial) — the top-up options. No dirhams, tokens, or per-action
 * cost ever leave the server (D3).
 */
export async function handleAllowanceRoute(req: IncomingMessage, res: ServerResponse, deps: AllowanceRouteDeps): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  if (!(method === 'GET' && path === '/allowance/status')) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  if (!deps.allowanceStatus) {
    sendJson(res, 200, { percentUsed: 0, exhausted: false, resetAt: null, canTopUp: false, options: [] });
    return true;
  }
  const s = await deps.allowanceStatus.status(identity.userId);
  // D10: only a subscribed (active) account may buy top-ups — a trial has no card on file.
  const ent = deps.billing ? await deps.billing.entitlement(identity.userId, Date.now()) : null;
  const canTopUp = ent?.status === 'active';
  sendJson(res, 200, {
    percentUsed: s.percentUsed,
    exhausted: s.exhausted,
    resetAt: new Date(s.resetAtMs).toISOString(),
    canTopUp,
    options: canTopUp ? TOP_UP_OPTIONS.map((o) => ({ id: o.id, label: o.label, priceAed: o.priceAed })) : [],
  });
  return true;
}
