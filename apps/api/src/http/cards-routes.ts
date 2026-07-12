import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { CardScanner } from '../ports/card-scanner.js';
import { BadJsonError, extractToken, readRawBody, sendJson } from './helpers.js';

export interface CardRouteDeps {
  auth: AuthService;
  scanner: CardScanner;
}

/**
 * POST /cards/scan — vision-scan a business card into a structured contact
 * PROPOSAL (P4-5). Nothing is saved here; the rep confirms, then creates the
 * client/contact via the normal endpoints.
 */
export async function handleCardRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CardRouteDeps,
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'POST' || (req.url ?? '/').split('?')[0] !== '/cards/scan') return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  try {
    const image = await readRawBody(req);
    if (image.length === 0) {
      sendJson(res, 400, { error: 'validation', message: 'No image was uploaded.' });
      return true;
    }
    sendJson(res, 200, await deps.scanner.scan(new Uint8Array(image)));
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid upload.' });
      return true;
    }
    throw err;
  }
}
