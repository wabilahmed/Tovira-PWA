import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HotLeadsStore } from '../ports/hot-leads.js';
import { deliveryStatusOf, leadTagOf, verifySvix } from '../services/leads/resend-webhook.js';
import { sendJson } from './helpers.js';

/**
 * [P63-9 · owner] POST /webhooks/resend: Resend's delivery events for the invite email (delivered, bounced, marked spam),
 * matched to the lead by the "lead" tag the email was sent with. Public (Resend calls it), verified by its signature.
 * SHIPPED DARK: the signing secret is not wired yet (key-first: RESEND_WEBHOOK_SECRET in tovira/prod/app, mapped in
 * ecs.tf, then the Resend webhook added). Until then every call is refused (503) and nothing is recorded.
 */
export interface ResendWebhookDeps { secret?: string; leads: Pick<HotLeadsStore, 'get' | 'setInviteDelivery'>; now?: () => number }

async function rawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 256_000) break; chunks.push(c as Buffer); }
  return Buffer.concat(chunks).toString('utf8');
}
const h = (req: IncomingMessage, k: string): string | undefined => { const v = req.headers[k]; return Array.isArray(v) ? v[0] : v; };

export async function handleResendWebhook(req: IncomingMessage, res: ServerResponse, deps: ResendWebhookDeps): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'POST' || (req.url ?? '').split('?')[0] !== '/webhooks/resend') return false;
  if (!deps.secret) { sendJson(res, 503, { error: 'not_configured' }); return true; }
  const body = await rawBody(req);
  const now = (deps.now ?? Date.now)();
  if (!verifySvix(deps.secret, { id: h(req, 'svix-id'), timestamp: h(req, 'svix-timestamp'), signature: h(req, 'svix-signature') }, body, now)) {
    sendJson(res, 401, { error: 'bad_signature' });
    return true;
  }
  let event: { type?: unknown; created_at?: unknown; data?: unknown };
  try { event = JSON.parse(body) as typeof event; } catch { sendJson(res, 400, { error: 'bad_request' }); return true; }
  const status = deliveryStatusOf(event.type);
  const leadId = leadTagOf(event.data);
  if (status && leadId && (await deps.leads.get(leadId))) {
    const at = typeof event.created_at === 'string' && Number.isFinite(Date.parse(event.created_at)) ? Date.parse(event.created_at) : now;
    await deps.leads.setInviteDelivery(leadId, status, at);
  }
  sendJson(res, 200, { ok: true }); // anything else (opened, clicked, other emails) is acknowledged and ignored
  return true;
}
