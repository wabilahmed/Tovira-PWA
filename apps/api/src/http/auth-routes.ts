import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthError, AuthService } from '../services/auth/auth-service.js';
import {
  BadJsonError,
  clearedSessionCookie,
  extractToken,
  readJsonBody,
  sendJson,
  sessionCookie,
} from './helpers.js';

interface Credentials {
  email: string;
  password: string;
}

function readCredentials(body: unknown): Credentials {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email : '';
  const password = typeof b.password === 'string' ? b.password : '';
  return { email, password };
}

export interface AuthRouteOptions {
  cookieSecure: boolean;
  /** Called after a successful signup (starts the trial). */
  onSignup?: (userId: string, email: string) => Promise<void>;
}

/** Handle an /auth/* or /me request. Returns true if it handled the request. */
export async function handleAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService,
  opts: AuthRouteOptions,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const url = (req.url ?? '/').split('?')[0];

  try {
    if (method === 'POST' && url === '/auth/signup') {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      // [P5-4] consent: explicit refusal blocks sensitive storage/processing.
      if (body.consent === false) {
        sendJson(res, 400, { error: 'consent_required', message: 'Please accept the terms to continue.' });
        return true;
      }
      const { email, password } = readCredentials(body);
      const result = await auth.signup(email, password);
      await opts.onSignup?.(result.user.id, result.user.email);
      sendJson(res, 201, result, {
        'set-cookie': sessionCookie(result.token, auth.sessionTtlSeconds, opts.cookieSecure),
      });
      return true;
    }

    if (method === 'POST' && url === '/auth/login') {
      const { email, password } = readCredentials(await readJsonBody(req));
      const result = await auth.login(email, password);
      sendJson(res, 200, result, {
        'set-cookie': sessionCookie(result.token, auth.sessionTtlSeconds, opts.cookieSecure),
      });
      return true;
    }

    if (method === 'POST' && url === '/auth/logout') {
      await auth.logout(extractToken(req));
      sendJson(res, 200, { ok: true }, { 'set-cookie': clearedSessionCookie(opts.cookieSecure) });
      return true;
    }

    if (method === 'GET' && url === '/me') {
      const identity = await auth.authenticate(extractToken(req));
      if (!identity) {
        sendJson(res, 401, { error: 'unauthorized' });
        return true;
      }
      const user = await auth.getPublicUser(identity.userId);
      if (!user) {
        sendJson(res, 401, { error: 'unauthorized' });
        return true;
      }
      sendJson(res, 200, { user });
      return true;
    }

    return false;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    if (err instanceof AuthError) {
      // Typed, safe message (generic for credentials → no user enumeration).
      sendJson(res, err.status, { error: errorCode(err), message: err.message });
      return true;
    }
    throw err;
  }
}

function errorCode(err: AuthError): string {
  return err.name
    .replace(/Error$/, '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}
