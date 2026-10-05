import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import { extractToken, readJsonBody, readRawBody, sendJson } from './helpers.js';
import { TOP_UP_OPTIONS, topUpOptionById } from '../config.js';

export interface BillingRouteDeps {
  auth: AuthService;
  billing: BillingService;
  /** [TASK 3] Public app base URL — the Stripe Customer Portal returns the rep here (the Billing page). */
  appBaseUrl?: string;
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
  const isCustomer = method === 'PATCH' && path === '/billing/customer';
  const isTopUp = method === 'POST' && path === '/billing/top-up';
  const isPortal = method === 'POST' && path === '/billing/portal';
  if (!isCheckout && !isStatus && !isCustomer && !isTopUp && !isPortal) return false;

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

  // [TASK 3] Open the Stripe Customer Portal (manage subscription: cancel at period end, update card,
  // invoice history). Only a subscriber has a Stripe customer — otherwise 409 with a clear message.
  if (isPortal) {
    const returnUrl = `${deps.appBaseUrl ?? ''}/billing`;
    const session = await deps.billing.portalSession(userId, returnUrl);
    if (!session) {
      sendJson(res, 409, { error: 'no_subscription', message: 'Subscribe first to manage your subscription.' });
      return true;
    }
    sendJson(res, 200, session);
    return true;
  }

  // [USAGE-ALLOWANCE · D6/D10/D12] One-time top-up checkout. Trial accounts (no card on file) can't buy
  // top-ups — refuse with a message pointing to subscribing instead.
  if (isTopUp) {
    const ent = await deps.billing.entitlement(userId, Date.now());
    if (ent.status !== 'active') {
      sendJson(res, 403, { error: 'top_up_requires_subscription', message: 'Top-ups are available once you subscribe. During the trial, subscribe to add usage.' });
      return true;
    }
    const body = (await readJsonBody(req).catch(() => ({}))) as { optionId?: unknown };
    const option = typeof body.optionId === 'string' ? topUpOptionById(body.optionId) : undefined;
    if (!option) {
      sendJson(res, 400, { error: 'validation', message: 'Choose a top-up option.', options: TOP_UP_OPTIONS });
      return true;
    }
    const user = await deps.auth.getPublicUser(userId);
    sendJson(res, 200, await deps.billing.topUpCheckout(userId, user?.email ?? '', option.id, option.priceAed));
    return true;
  }

  // INVOICE-DATA: set the billing name/company (Settings) and sync it to the Stripe customer.
  if (isCustomer) {
    const body = (await readJsonBody(req).catch(() => ({}))) as { name?: unknown; company?: unknown };
    const details: { name?: string; company?: string } = {};
    if (typeof body.name === 'string') details.name = body.name.trim();
    if (typeof body.company === 'string') details.company = body.company.trim();
    await deps.billing.setBillingName(userId, details);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const user = await deps.auth.getPublicUser(userId);
  const body = (await readJsonBody(req).catch(() => ({}))) as { plan?: unknown; name?: unknown; company?: unknown };
  const plan = body.plan === 'annual' ? 'annual' : 'monthly';
  // Collect a name/company at checkout so the very first invoice carries them (INVOICE-DATA).
  const details: { name?: string; company?: string } = {};
  if (typeof body.name === 'string' && body.name.trim()) details.name = body.name.trim();
  if (typeof body.company === 'string' && body.company.trim()) details.company = body.company.trim();
  sendJson(res, 200, await deps.billing.checkout(userId, user?.email ?? '', plan, details));
  return true;
}
