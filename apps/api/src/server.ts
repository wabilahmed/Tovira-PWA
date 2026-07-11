import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import type { AuthService } from './services/auth/auth-service.js';
import { handleAuthRoute } from './http/auth-routes.js';
import { sendJson } from './http/helpers.js';

export interface ApiDeps {
  pool: Pool;
  auth: AuthService;
  cookieSecure?: boolean;
}

/**
 * The Phase 0 API: health, auth (signup/login/logout), and a protected /me.
 * Everything cloud-swappable is injected (pool, auth) — the server just routes.
 */
export function createApiServer(deps: ApiDeps): Server {
  const cookieSecure = deps.cookieSecure ?? false;

  return createServer((req, res) => {
    void dispatch(req, res).catch((err: unknown) => {
      // Never leak internals; never leave a hanging socket.
      console.error(`[api] unhandled: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
    });

    async function dispatch(
      request: typeof req,
      response: typeof res,
    ): Promise<void> {
      const url = (request.url ?? '/').split('?')[0];

      if (request.method === 'GET' && (url === '/health' || url === '/healthz')) {
        try {
          await deps.pool.query('SELECT 1');
          sendJson(response, 200, { status: 'ok' });
        } catch {
          sendJson(response, 503, { status: 'degraded', reason: 'database unavailable' });
        }
        return;
      }

      if (await handleAuthRoute(request, response, deps.auth, { cookieSecure })) return;

      if (request.method === 'GET' && url === '/') {
        sendJson(response, 200, { name: 'tovira-api', status: 'ok' });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    }
  });
}
