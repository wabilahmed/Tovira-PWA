import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { NotificationRepository } from '../ports/notification-repository.js';
import type { ScanService, ScanConfig } from '../services/scan/scan-service.js';
import { extractToken, sendJson } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProactiveRouteDeps {
  auth: AuthService;
  clients: ClientRepository;
  notifications: NotificationRepository;
  scan: ScanService;
  scanConfig: ScanConfig;
}

/** Handle /cold, /notifications and /scan. Returns true if handled. */
export async function handleProactiveRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProactiveRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  const isCold = method === 'GET' && path === '/cold';
  const isNotifications = method === 'GET' && path === '/notifications';
  const isScan = method === 'POST' && path === '/scan';
  if (!isCold && !isNotifications && !isScan) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  if (isCold) {
    // The in-app cold list (P3-5) — always reachable, independent of push.
    const raw = url.searchParams.get('days');
    const parsed = raw !== null && raw !== '' ? Number(raw) : NaN;
    const days = Number.isFinite(parsed) && parsed >= 0 ? parsed : deps.scanConfig.coldThresholdDays;
    const clients = await deps.clients.listGoingCold(userId, Date.now() - days * DAY_MS);
    sendJson(res, 200, { clients });
    return true;
  }

  if (isNotifications) {
    sendJson(res, 200, { notifications: await deps.notifications.listByUser(userId) });
    return true;
  }

  // POST /scan — run the daily brain now (prod triggers this via the scheduler).
  sendJson(res, 200, await deps.scan.runAll(userId, Date.now(), deps.scanConfig));
  return true;
}
