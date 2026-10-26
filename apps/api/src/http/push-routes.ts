import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import { PushSubscriptionGoneError, type PushSender, type PushSubscription, type PushSubscriptionRepository } from '../ports/push.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

export interface PushRouteDeps {
  auth: AuthService;
  subscriptions: PushSubscriptionRepository;
  sender: PushSender;
  /** [P46-2] The VAPID PUBLIC key, served to the app at runtime (the web build never had it). Never the private key. */
  vapidPublicKey: string;
}

function isSubscription(v: unknown): v is PushSubscription {
  const s = v as PushSubscription;
  return !!s && typeof s.endpoint === 'string' && !!s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

/**
 * Handle GET /push/config, POST /push/subscribe, POST /push/status and POST /push/test. Returns true if handled.
 * [P46-2] /push/status and /push/test take this device's endpoint, so Settings shows the server's truth for THIS phone.
 */
export async function handlePushRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PushRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isSubscribe = method === 'POST' && path === '/push/subscribe';
  const isTest = method === 'POST' && path === '/push/test';
  const isConfig = method === 'GET' && path === '/push/config';
  const isStatus = method === 'POST' && path === '/push/status';
  if (!isSubscribe && !isTest && !isConfig && !isStatus) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  try {
    if (isConfig) {
      sendJson(res, 200, { vapidPublicKey: deps.vapidPublicKey });
      return true;
    }
    if (isStatus) {
      const body = (await readJsonBody(req)) as { endpoint?: unknown };
      const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
      const stored = !!endpoint && (await deps.subscriptions.listByUser(userId)).some((s) => s.endpoint === endpoint);
      sendJson(res, 200, { stored });
      return true;
    }
    if (isSubscribe) {
      const body = await readJsonBody(req);
      if (!isSubscription(body)) {
        sendJson(res, 400, { error: 'validation', message: 'A valid push subscription is required.' });
        return true;
      }
      await deps.subscriptions.save(userId, body);
      sendJson(res, 201, { ok: true });
      return true;
    }

    // Send a test notification to all of the rep's subscriptions, and say what happened on THIS device.
    const body = (await readJsonBody(req).catch(() => null)) as { endpoint?: unknown } | null;
    const here = typeof body?.endpoint === 'string' ? body.endpoint : null;
    const subs = await deps.subscriptions.listByUser(userId);
    let sent = 0;
    let thisDevice: 'sent' | 'failed' | 'gone' | 'not_set_up' = 'not_set_up';
    for (const sub of subs) {
      const isHere = sub.endpoint === here;
      try {
        await deps.sender.send(sub, { title: 'Tovira', body: 'Notifications work on this phone.' });
        sent += 1;
        if (isHere) thisDevice = 'sent';
      } catch (err) {
        // A failed push must not break the flow — the in-app list is the fallback. A gone one is deleted.
        if (err instanceof PushSubscriptionGoneError) await deps.subscriptions.remove(userId, sub.endpoint);
        if (isHere) thisDevice = err instanceof PushSubscriptionGoneError ? 'gone' : 'failed';
      }
    }
    sendJson(res, 200, here === null ? { sent } : { sent, thisDevice });
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
