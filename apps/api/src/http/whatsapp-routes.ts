import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { WhatsAppService } from '../services/whatsapp/whatsapp-service.js';
import { validHubSignature, verifyHandshake } from '../services/whatsapp/signature.js';
import { BadJsonError, extractToken, readJsonBody, readRawBody, sendJson } from './helpers.js';

/**
 * [P67 · owner] Send a chat export to Tovira's WhatsApp number. BUILT DARK: without `whatsapp` (WHATSAPP_INGEST_ENABLED
 * off, or its keys not set) every path here is a 404 and nothing is visible.
 *
 *   GET    /webhooks/whatsapp   Meta's subscribe handshake (verify token).                     public
 *   POST   /webhooks/whatsapp   inbound messages; X-Hub-Signature-256 checked with the app secret. public, signed
 *   GET    /whatsapp/link       Settings: the linked number (or none) and Tovira's number.       rep
 *   POST   /whatsapp/link       { phone } → a one-time code and the wa.me link that sends it.   rep
 *   DELETE /whatsapp/link       unlink.                                                          rep
 *
 * The webhook is the only unauthenticated route, and nothing it receives is processed without a valid signature. A
 * failed check is logged as a failure only (never the body).
 */
export interface WhatsAppRouteDeps {
  auth: AuthService;
  whatsapp?: { service: WhatsAppService; appSecret: string; verifyToken: string };
}

/** Meta batches up to 1,000 updates in one POST, at most 3 MB. */
const MAX_WEBHOOK_BYTES = 3_000_000;

export async function handleWhatsAppRoute(req: IncomingMessage, res: ServerResponse, deps: WhatsAppRouteDeps): Promise<boolean> {
  const method = req.method ?? 'GET';
  const [path, query = ''] = (req.url ?? '/').split('?');
  if (path !== '/webhooks/whatsapp' && path !== '/whatsapp/link') return false;
  const wa = deps.whatsapp;
  if (!wa) { sendJson(res, 404, { error: 'not_found' }); return true; } // switched off: the feature does not exist

  if (path === '/webhooks/whatsapp') {
    if (method === 'GET') {
      const challenge = verifyHandshake(new URLSearchParams(query), wa.verifyToken);
      if (challenge === null) { sendJson(res, 403, { error: 'forbidden' }); return true; }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(challenge);
      return true;
    }
    if (method !== 'POST') { sendJson(res, 405, { error: 'method_not_allowed' }); return true; }
    let raw: Buffer;
    try { raw = await readRawBody(req, MAX_WEBHOOK_BYTES); } catch { sendJson(res, 413, { error: 'too_large' }); return true; }
    if (!validHubSignature(raw, req.headers['x-hub-signature-256'], wa.appSecret)) {
      console.warn('[whatsapp] webhook signature check failed; ignored');
      sendJson(res, 401, { error: 'bad_signature' });
      return true;
    }
    let body: unknown;
    try { body = JSON.parse(raw.toString('utf8')); } catch { sendJson(res, 400, { error: 'bad_request' }); return true; }
    wa.service.accept(body); // handled in the background; Meta gets its 200 at once
    sendJson(res, 200, { ok: true });
    return true;
  }

  // Settings (the rep)
  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) { sendJson(res, 401, { error: 'unauthorized' }); return true; }
  const userId = identity.userId;
  if (method === 'GET') { sendJson(res, 200, await wa.service.status(userId)); return true; }
  if (method === 'DELETE') { await wa.service.unlink(userId); sendJson(res, 200, await wa.service.status(userId)); return true; }
  if (method === 'POST') {
    let body: { phone?: unknown };
    try { body = (await readJsonBody(req)) as { phone?: unknown }; } catch (err) {
      if (err instanceof BadJsonError) { sendJson(res, 400, { error: 'validation', message: 'Enter your WhatsApp number.' }); return true; }
      throw err;
    }
    const r = await wa.service.startLink(userId, typeof body.phone === 'string' ? body.phone : '');
    if (!r.ok) { sendJson(res, r.status, { error: r.status === 409 ? 'taken' : 'validation', message: r.message }); return true; }
    sendJson(res, 200, r);
    return true;
  }
  sendJson(res, 405, { error: 'method_not_allowed' });
  return true;
}
