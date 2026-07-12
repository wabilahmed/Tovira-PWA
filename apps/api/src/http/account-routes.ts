import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { AccountService } from '../services/account/account-service.js';
import { extractToken, sendJson } from './helpers.js';

export interface AccountRouteDeps {
  auth: AuthService;
  account: AccountService;
}

/** GET /account/export and DELETE /account (P5-4). */
export async function handleAccountRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AccountRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0];
  const isExport = method === 'GET' && path === '/account/export';
  const isDelete = method === 'DELETE' && path === '/account';
  if (!isExport && !isDelete) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  if (isExport) {
    sendJson(res, 200, await deps.account.exportData(identity.userId));
  } else {
    await deps.account.deleteAccount(identity.userId);
    sendJson(res, 200, { ok: true, message: 'Your account and data have been deleted.' });
  }
  return true;
}
