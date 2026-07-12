import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { PushSender, PushSubscription, PushSubscriptionRepository } from '../ports/push.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

export interface PushRouteDeps {
  auth: AuthService;
  subscriptions: PushSubscriptionRepository;
  sender: PushSender;
}

function isSubscription(v: unknown): v is PushSubscription {
  const s = v as PushSubscription;
  return !!s && typeof s.endpoint === 'string' && !!s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

/** Handle POST /push/subscribe and POST /push/test. Returns true if handled. */
export async function handlePushRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PushRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  const isSubscribe = method === 'POST' && path === '/push/subscribe';
  const isTest = method === 'POST' && path === '/push/test';
  if (!isSubscribe && !isTest) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  try {
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

    // Send a test notification to all of the rep's subscriptions.
    const subs = await deps.subscriptions.listByUser(userId);
    let sent = 0;
    for (const sub of subs) {
      try {
        await deps.sender.send(sub, { title: 'Tovira', body: 'Notifications are on 🎉' });
        sent += 1;
      } catch {
        // A failed push must not break the flow — the in-app list is the fallback.
      }
    }
    sendJson(res, 200, { sent });
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
