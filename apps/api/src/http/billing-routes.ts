import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { NoteRepository } from '../ports/note-repository.js';
import { countDistinctClientsWithNotes } from './notes-routes.js';
import { extractToken, readJsonBody, readRawBody, sendJson } from './helpers.js';

export interface BillingRouteDeps {
  auth: AuthService;
  billing: BillingService;
  clients: ClientRepository;
  notes: NoteRepository;
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
  const isIncentive = method === 'GET' && path === '/billing/incentive';
  const isCustomer = method === 'PATCH' && path === '/billing/customer';
  if (!isCheckout && !isStatus && !isIncentive && !isCustomer) return false;

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

  if (isIncentive) {
    const distinct = await countDistinctClientsWithNotes(deps.clients, deps.notes, userId);
    sendJson(res, 200, await deps.billing.extensionIncentive(userId, distinct, Date.now()));
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
