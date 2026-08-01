import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { RecallService } from '../services/recall/recall-service.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

export interface RecallRouteDeps {
  auth: AuthService;
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
