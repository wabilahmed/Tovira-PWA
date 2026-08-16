import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { RecallService } from '../services/recall/recall-service.js';
import { BadJsonError, extractToken, readJsonBody, sendJson, requireEntitled } from './helpers.js';

export interface RecallRouteDeps {
  auth: AuthService;
  billing: BillingService;
  recall: RecallService;
}

/** POST /recall { question } — conversational recall over the rep's notes (P4-8).
 *  Voice is transcribed client-side (existing transcription) then asked as text. */
export async function handleRecallRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RecallRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'POST' || (req.url ?? '/').split('?')[0] !== '/recall') return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
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
