import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import { extractToken, readRawBody, sendJson } from './helpers.js';

export interface BillingRouteDeps {
  auth: AuthService;
  billing: BillingService;
}

export async function handleBillingRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: BillingRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;

  // Webhook is UNAUTHENTICATED (Stripe calls it) but signature-verified.
  if (method === 'POST' && path === '/billing/webhook') {
    const payload = (await readRawBody(req)).toString('utf8');
    const signature = String(req.headers['stripe-signature'] ?? '');
    sendJson(res, await deps.billing.handleWebhook(payload, signature), { ok: true });
    return true;
  }

  const isCheckout = method === 'POST' && path === '/billing/checkout';
  const isStatus = method === 'GET' && path === '/billing/status';
  if (!isCheckout && !isStatus) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  if (isStatus) {
    sendJson(res, 200, await deps.billing.entitlement(userId, Date.now()));
    return true;
  }

  const user = await deps.auth.getPublicUser(userId);
  sendJson(res, 200, await deps.billing.checkout(userId, user?.email ?? ''));
  return true;
}
