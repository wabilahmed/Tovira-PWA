import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccessRequestService, AccessRequestValidationError, type RawAccessRequest } from '../services/access/access-request-service.js';
import type { AccessRequestRecord } from '../ports/access-request-repository.js';
import type { RateLimiter } from '../services/security/rate-limiter.js';
import { clientIp, readJsonBody, sendJson, BadJsonError } from './helpers.js';

export interface AccessRequestRouteOptions {
  service: AccessRequestService;
  /** Per-IP throttle; counts EVERY request. */
  limiter?: RateLimiter;
  /** Best-effort owner notification (the row is already written before this runs). */
  notify?: (record: AccessRequestRecord) => Promise<void>;
}

/** The hidden honeypot field name. A human never sees or fills it; a form-filling bot usually does.
 *  Chosen to look like a real field a bot would complete. */
const HONEYPOT_FIELD = 'company_url';

/** Handle POST /access-request (public, no session). Returns true if it handled the request. */
export async function handleAccessRequestRoute(req: IncomingMessage, res: ServerResponse, opts: AccessRequestRouteOptions): Promise<boolean> {
  const method = req.method ?? 'GET';
  const url = (req.url ?? '/').split('?')[0];
  if (!(method === 'POST' && url === '/access-request')) return false;

  const ip = clientIp(req);

  // Rate limit FIRST, counting every request (not just failures) — a submit endpoint has no failed-vs-
  // succeeded to key on, so counting only failures (the login-limiter semantic) would never throttle.
  if (opts.limiter) {
    const gate = opts.limiter.check(ip);
    if (gate.limited) {
      sendJson(res, 429, { error: 'rate_limited', message: 'Too many requests — please wait a little and try again.' }, { 'retry-after': String(gate.retryAfterSec) });
      return true;
    }
    opts.limiter.record(ip);
  }

  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_json', message: 'Could not read the submission.' });
      return true;
    }
    throw err;
  }

  // Honeypot: a filled hidden field means a bot. Respond with a neutral success so we don't teach the
  // bot what tripped it; write nothing and notify no one.
  const trap = body[HONEYPOT_FIELD];
  if (typeof trap === 'string' && trap.trim() !== '') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  try {
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent']! : null;
    // The row is written here. The notification below is best-effort and must never fail the request.
    const record = await opts.service.submit(body as RawAccessRequest, { sourceIp: ip, userAgent });
    try {
      await opts.notify?.(record);
    } catch (err) {
      console.warn('access-request owner notification failed; the request was still recorded', err);
    }
    sendJson(res, 201, { ok: true, id: record.id });
    return true;
  } catch (err) {
    if (err instanceof AccessRequestValidationError) {
      sendJson(res, 400, { error: 'validation', field: err.field, message: err.message });
      return true;
    }
    throw err;
  }
}
