import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ProcessingStatusService } from '../services/processing/processing-status.js';
import type { AppPresence } from '../services/processing/presence.js';
import { extractToken, sendJson } from './helpers.js';

/**
 * [P65-1 · owner] GET /processing: what Tovira is doing with what the rep sent, across every client (the app polls it
 * every few seconds while something is working, and stops when nothing is). Rep session only. Not billing-gated: a rep
 * whose allowance ran out still sees that their note is saved and why it waits. Called while the app is visible
 * (the default), it also marks the app open, so a push goes only when it is closed (P65-5).
 */
export interface ProcessingRouteDeps {
  auth: Pick<AuthService, 'authenticate'>;
  status: Pick<ProcessingStatusService, 'status'>;
  presence?: AppPresence;
  now?: () => number;
}

export async function handleProcessingRoute(req: IncomingMessage, res: ServerResponse, deps: ProcessingRouteDeps): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x');
  if ((req.method ?? 'GET') !== 'GET' || url.pathname !== '/processing') return false;
  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) { sendJson(res, 401, { error: 'unauthorized' }); return true; }
  if (url.searchParams.get('visible') !== '0') deps.presence?.seen(identity.userId);
  sendJson(res, 200, await deps.status.status(identity.userId, (deps.now ?? Date.now)()), { 'cache-control': 'no-store' });
  return true;
}
