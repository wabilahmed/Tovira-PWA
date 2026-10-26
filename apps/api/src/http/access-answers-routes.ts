import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { AccessAnswersService } from '../services/access/access-answers-service.js';
import { AccessRequestValidationError, type RawAccessRequest } from '../services/access/access-request-service.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

/** [P46-6c.2] The refusal every capture route sends while a hot-lead invitee has not answered and confirmed. */
export const ANSWERS_REQUIRED = { error: 'answers_required', message: 'Answer a few questions and tick the confirmation first.' } as const;

/** GET /me/access-answers (is the rep asked, and for what) and POST /me/access-answers (the answers + the confirmation). */
export async function handleAccessAnswersRoute(req: IncomingMessage, res: ServerResponse, deps: { auth: AuthService; answers: AccessAnswersService }): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  if (path !== '/me/access-answers' || (method !== 'GET' && method !== 'POST')) return false;
  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) { sendJson(res, 401, { error: 'unauthorized' }); return true; }
  if (method === 'GET') { sendJson(res, 200, await deps.answers.status(identity.userId)); return true; }
  try {
    await deps.answers.submit(identity.userId, (await readJsonBody(req)) as RawAccessRequest);
    sendJson(res, 200, await deps.answers.status(identity.userId));
  } catch (err) {
    if (err instanceof AccessRequestValidationError) { sendJson(res, 400, { error: 'validation', field: err.field, message: err.message }); return true; }
    if (err instanceof BadJsonError) { sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' }); return true; }
    throw err;
  }
  return true;
}
