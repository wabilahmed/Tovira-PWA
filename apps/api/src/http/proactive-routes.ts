import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { NotificationRepository } from '../ports/notification-repository.js';
import type { ScanService, ScanConfig } from '../services/scan/scan-service.js';
import type { PushDispatchService } from '../services/push/push-dispatch-service.js';
import { extractToken, sendJson } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProactiveRouteDeps {
  /** [P40-2] erasure-window restriction (optional: older wiring → none). */
  restriction?: { forUser(userId: string): Promise<import('../services/erasure/restriction.js').Restriction> };
  auth: AuthService;
  clients: ClientRepository;
  notifications: NotificationRepository;
  scan: ScanService;
  scanConfig: ScanConfig;
  pushDispatch: PushDispatchService;
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
    // [P40-2] An alert written before the window opened may quote the restricted person: withheld while it's open
    // (still stored). An alert ABOUT the erasure itself is always shown.
    const r = deps.restriction ? await deps.restriction.forUser(userId) : null;
    const all = await deps.notifications.listByUser(userId);
    const shown = r?.active ? all.filter((n) => n.type.startsWith('erasure_') || !(r.restrictsText(n.title) || r.restrictsText(n.body))) : all;
    sendJson(res, 200, { notifications: shown });
    return true;
  }

  // POST /scan — run the daily brain now (prod triggers this via the scheduler).
  // Every alert is recorded in-app; the silence budget then pushes only the
  // loudest few (max 2/rep/day). Suppressed alerts still show in-app.
  const now = Date.now();
  const summary = await deps.scan.runAll(userId, now, deps.scanConfig);
  const { sent, heldForDigest } = await deps.pushDispatch.dispatch(userId, summary.pushables, now);
  sendJson(res, 200, {
    overduePromises: summary.overduePromises,
    nudges: summary.nudges,
    goingCold: summary.goingCold,
    dateReminders: summary.dateReminders,
    chatRefresh: summary.chatRefresh,
    pushed: sent.length,
    heldForDigest: heldForDigest.length,
  });
  return true;
}
