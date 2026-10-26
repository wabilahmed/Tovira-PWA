import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { AskCaptureService } from '../services/recall/ask-capture-service.js';
import { BadJsonError, extractToken, readJsonBody, sendJson, requireEntitled } from './helpers.js';
import { ANSWERS_REQUIRED } from './access-answers-routes.js';

export interface RecallRouteDeps {
  /** [P46-6c.2] True while a hot-lead invitee has not answered and confirmed: captures are refused. */
  answersRequired?: (userId: string) => Promise<boolean>;
  auth: AuthService;
  billing: BillingService;
  /** [ASK-CAPTURE] the pending-capture queue + confirm/reject; [P39-7] POST /captures holds an "Add a note". */
  capture?: AskCaptureService;
}

const CONFIRM_RE = /^\/captures\/([^/]+)\/confirm$/;
const REJECT_RE = /^\/captures\/([^/]+)\/reject$/;

/** [P39-7] The free-text Ask (POST /recall) is gone — Find answers fixed questions without a model. What stays
 *  is the pending-note flow: POST /captures { clientId, statement } holds a rep's note ("Add a note" on the
 *  client page) for To Confirm; GET /captures lists them; POST /captures/:id/confirm|reject resolves one. */
export async function handleRecallRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RecallRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isCreate = method === 'POST' && path === '/captures';
  const isQueue = method === 'GET' && path === '/captures';
  const confirmMatch = method === 'POST' ? CONFIRM_RE.exec(path) : null;
  const rejectMatch = method === 'POST' ? REJECT_RE.exec(path) : null;
  if (!deps.capture || (!isCreate && !isQueue && !confirmMatch && !rejectMatch)) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  // [ASK-CAPTURE] the pending-capture queue + one-tap confirm/reject (nothing enters the vault
  // until confirm). These are the rep's own pending statements — no entitlement gate.
  // [P46-6c.2] no capture before a hot-lead invitee has answered and confirmed
  if (isCreate && deps.answersRequired && (await deps.answersRequired(identity.userId))) { sendJson(res, 403, ANSWERS_REQUIRED); return true; }
  if (isQueue) {
    sendJson(res, 200, { captures: await deps.capture.listPending(identity.userId) });
    return true;
  }
  if (confirmMatch || rejectMatch) {
    const noteId = decodeURIComponent((confirmMatch ?? rejectMatch)![1]!);
    const ok = confirmMatch
      ? await deps.capture.confirm(identity.userId, noteId)
      : await deps.capture.reject(identity.userId, noteId);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }
  // "Add a note": the held statement runs the certified engine (held for confirmation) — an AI capture, so
  // it is entitlement-gated like every other capture.
  if (!(await requireEntitled(deps.billing, identity.userId, res))) return true;
  try {
    const body = (await readJsonBody(req)) as { clientId?: unknown; statement?: unknown };
    const clientId = typeof body.clientId === 'string' ? body.clientId : '';
    const statement = typeof body.statement === 'string' ? body.statement.trim() : '';
    if (!clientId || !statement) {
      sendJson(res, 400, { error: 'validation', message: 'Write the note first.' });
      return true;
    }
    const held = await deps.capture.capture(identity.userId, clientId, statement, new Date().toISOString().slice(0, 10));
    if (!held) { sendJson(res, 404, { error: 'not_found' }); return true; }
    sendJson(res, 201, { capture: held });
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
