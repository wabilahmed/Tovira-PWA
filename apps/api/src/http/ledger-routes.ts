import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { LedgerService } from '../services/ledger/ledger-service.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

export interface LedgerRouteDeps {
  auth: AuthService;
  ledger: LedgerService;
}

const DEAL_VALUE_RE = /^\/clients\/([^/]+)\/deal-value$/;

/** GET /ledger and POST /clients/:id/deal-value (P4-11). */
export async function handleLedgerRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LedgerRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isSummary = method === 'GET' && path === '/ledger';
  const dealMatch = method === 'POST' ? DEAL_VALUE_RE.exec(path) : null;
  if (!isSummary && !dealMatch) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  if (isSummary) {
    sendJson(res, 200, await deps.ledger.summary(identity.userId));
    return true;
  }

  try {
    const body = (await readJsonBody(req)) as { aed?: unknown };
    const aed = typeof body.aed === 'number' ? body.aed : NaN;
    if (!Number.isFinite(aed) || aed < 0) {
      sendJson(res, 400, { error: 'validation', message: 'A non-negative deal value (AED) is required.' });
      return true;
    }
    await deps.ledger.setDealValue(identity.userId, decodeURIComponent(dealMatch![1]!), aed);
    sendJson(res, 200, { ok: true });
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
