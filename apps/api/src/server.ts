import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';

/**
 * The API skeleton for Phase 0: a health endpoint that also proves DB
 * connectivity, so `docker compose up --wait` can gate on a truly-ready service.
 */
export function createApiServer(pool: Pool): Server {
  return createServer((req, res) => {
    const url = req.url ?? '/';

    if (req.method === 'GET' && (url === '/health' || url === '/healthz')) {
      void pool
        .query('SELECT 1')
        .then(() => sendJson(res, 200, { status: 'ok' }))
        .catch(() => sendJson(res, 503, { status: 'degraded', reason: 'database unavailable' }));
      return;
    }

    if (req.method === 'GET' && url === '/') {
      sendJson(res, 200, { name: 'tovira-api', status: 'ok' });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  });
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}
