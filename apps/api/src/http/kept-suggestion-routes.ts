import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { KeptSuggestionService } from '../services/promises/kept-suggestion-service.js';
import { extractToken, sendJson } from './helpers.js';

export interface KeptSuggestionRouteDeps {
  auth: AuthService;
  keptSuggestions: KeptSuggestionService;
}

const ACTION_RE = /^\/promises\/kept-suggestions\/([^/]+)\/(done|undo|not-yet)$/;

/**
 * [P24-2] To Confirm "Looks like you sent it — Mark done?":
 *   GET  /promises/kept-suggestions            → open suggestions, each with the copy + BOTH receipts
 *   POST /promises/kept-suggestions/:id/done    → the rep's say-so closes the promise (undoable)
 *   POST /promises/kept-suggestions/:id/undo    → reopen the promise; the suggestion is back
 *   POST /promises/kept-suggestions/:id/not-yet → dismiss; that delivery message never suggests again
 * Tenant-scoped through the service (another rep's id → 404).
 */
export async function handleKeptSuggestionRoute(req: IncomingMessage, res: ServerResponse, deps: KeptSuggestionRouteDeps): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isList = method === 'GET' && path === '/promises/kept-suggestions';
  const action = method === 'POST' ? ACTION_RE.exec(path) : null;
  if (!isList && !action) return false;
  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) { sendJson(res, 401, { error: 'unauthorized' }); return true; }
  if (isList) { sendJson(res, 200, { suggestions: await deps.keptSuggestions.listOpen(identity.userId) }); return true; }
  const id = decodeURIComponent(action![1]!);
  const verb = action![2]!;
  const ok = verb === 'done'
    ? await deps.keptSuggestions.markDone(identity.userId, id)
    : verb === 'undo'
      ? await deps.keptSuggestions.undo(identity.userId, id)
      : await deps.keptSuggestions.notYet(identity.userId, id);
  sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
  return true;
}
