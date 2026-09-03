import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { RecallService } from '../services/recall/recall-service.js';
import type { AskCaptureService } from '../services/recall/ask-capture-service.js';
import { BadJsonError, extractToken, readJsonBody, sendJson, requireEntitled } from './helpers.js';

export interface RecallRouteDeps {
  auth: AuthService;
  billing: BillingService;
  recall: RecallService;
  /** [ASK-CAPTURE] the pending-capture queue + confirm/reject. */
  capture?: AskCaptureService;
}

const CONFIRM_RE = /^\/captures\/([^/]+)\/confirm$/;
const REJECT_RE = /^\/captures\/([^/]+)\/reject$/;

/** POST /recall { question } — conversational recall over the rep's notes (P4-8).
 *  Voice is transcribed client-side (existing transcription) then asked as text. */
export async function handleRecallRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RecallRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isRecall = method === 'POST' && path === '/recall';
  const isQueue = method === 'GET' && path === '/captures';
  const confirmMatch = method === 'POST' ? CONFIRM_RE.exec(path) : null;
  const rejectMatch = method === 'POST' ? REJECT_RE.exec(path) : null;
  if (!isRecall && !isQueue && !confirmMatch && !rejectMatch) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  // [ASK-CAPTURE] the pending-capture queue + one-tap confirm/reject (nothing enters the vault
  // until confirm). These are the rep's own pending statements — no entitlement gate.
  if (deps.capture && (isQueue || confirmMatch || rejectMatch)) {
    if (isQueue) {
      sendJson(res, 200, { captures: await deps.capture.listPending(identity.userId) });
      return true;
    }
    const noteId = decodeURIComponent((confirmMatch ?? rejectMatch)![1]!);
    const ok = confirmMatch
      ? await deps.capture.confirm(identity.userId, noteId)
      : await deps.capture.reject(identity.userId, noteId);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }
  if (!isRecall) { sendJson(res, 404, { error: 'not_found' }); return true; }
  // Entitlement gate (P5-1/P5-2): a lapsed trial gets a calm 402, not the data.
  if (!(await requireEntitled(deps.billing, identity.userId, res))) return true;
  try {
    const body = (await readJsonBody(req)) as { question?: unknown };
    const question = typeof body.question === 'string' ? body.question : '';
    if (!question.trim()) {
      sendJson(res, 400, { error: 'validation', message: 'A question is required.' });
      return true;
    }
    sendJson(res, 200, await deps.recall.ask(identity.userId, question));
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
