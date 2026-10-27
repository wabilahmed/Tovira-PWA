import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { SamePersonService } from '../services/clients/same-person.js';
import { extractToken, readJsonBody, sendJson } from './helpers.js';

/**
 * [P50-2] The "same person?" cards in Needs your answer.
 *  GET  /confirmations/same-person          the pending questions (a restricted person never shows)
 *  POST /confirmations/same-person/:id      { answer: 'same' | 'different' }
 */
export async function handleSamePersonRoute(req: IncomingMessage, res: ServerResponse, deps: { auth: AuthService; samePerson?: SamePersonService }): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const one = /^\/confirmations\/same-person\/([^/]+)$/.exec(path);
  if (path !== '/confirmations/same-person' && !one) return false;
  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) { sendJson(res, 401, { error: 'unauthorized' }); return true; }
  if (!deps.samePerson) { sendJson(res, 501, { error: 'not_available' }); return true; }
  if (method === 'GET' && !one) { sendJson(res, 200, { questions: await deps.samePerson.list(identity.userId) }); return true; }
  if (method === 'POST' && one) {
    const body = (await readJsonBody(req)) as { answer?: unknown };
    if (body.answer !== 'same' && body.answer !== 'different') { sendJson(res, 400, { error: 'validation', message: 'Answer "same" or "different".' }); return true; }
    const ok = await deps.samePerson.answer(identity.userId, decodeURIComponent(one[1]!), body.answer);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
    return true;
  }
  sendJson(res, 405, { error: 'method_not_allowed' });
  return true;
}
