import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { TourService } from '../services/tour/tour-service.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

/** [P37] GET/PUT /me/tour (state, save the step) and POST /me/tour/complete — the rep's own account only. */
export async function handleTourRoute(req: IncomingMessage, res: ServerResponse, deps: { auth: AuthService; tour?: TourService }): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isState = path === '/me/tour' && (method === 'GET' || method === 'PUT');
  const isComplete = path === '/me/tour/complete' && method === 'POST';
  if (!isState && !isComplete) return false;
  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  if (!deps.tour) {
    sendJson(res, 200, { required: false, step: 0, steps: 0, version: 0 }); // not wired → never blocks a rep
    return true;
  }
  try {
    if (isComplete) {
      await deps.tour.complete(identity.userId);
    } else if (method === 'PUT') {
      const body = (await readJsonBody(req)) as { step?: unknown };
      try {
        await deps.tour.saveStep(identity.userId, typeof body.step === 'number' ? body.step : NaN);
      } catch (err) {
        if (err instanceof RangeError) { sendJson(res, 400, { error: 'validation', message: 'step out of range' }); return true; }
        throw err;
      }
    }
    sendJson(res, 200, await deps.tour.state(identity.userId));
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) { sendJson(res, 400, { error: 'bad_request', message: 'Invalid JSON.' }); return true; }
    throw err;
  }
}
