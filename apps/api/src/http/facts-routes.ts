import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { FactsRepository } from '../ports/facts-repository.js';
import { pendingConfirmations } from '../services/facts/confirmation.js';
import { extractToken, sendJson } from './helpers.js';

export interface FactsRouteDeps {
  auth: AuthService;
  facts: FactsRepository;
}

const CONFIRM_RE = /^\/promises\/([^/]+)\/confirm$/;

/** Handle /confirmations and /promises/:id/confirm. Returns true if handled. */
export async function handleFactsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: FactsRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;

  const isConfirmations = method === 'GET' && path === '/confirmations';
  const confirmMatch = method === 'POST' ? CONFIRM_RE.exec(path) : null;
  if (!isConfirmations && !confirmMatch) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  if (isConfirmations) {
    // The queue of uncertain items the rep still needs to confirm.
    const promises = await deps.facts.listPromisesByUser(userId);
    sendJson(res, 200, { promises: pendingConfirmations(promises) });
    return true;
  }

  const id = decodeURIComponent(confirmMatch![1]!);
  const ok = await deps.facts.confirmPromise(userId, id);
  sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
  return true;
}
