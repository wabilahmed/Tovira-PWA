import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

/** Handle a /clients or /clients/:id request. Returns true if it handled it. */
export async function handleClientRoute(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService,
  clients: ClientRepository,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  if (path !== '/clients' && !path.startsWith('/clients/')) return false;

  const identity = await auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  try {
    if (method === 'POST' && path === '/clients') {
      const body = (await readJsonBody(req)) as { name?: unknown; phone?: unknown };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        sendJson(res, 400, { error: 'validation', message: 'A client name is required.' });
        return true;
      }
      // Stored as entered (P4-7) — we never rewrite it or guess a country code.
      const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
      sendJson(res, 201, await clients.create(userId, name, phone));
      return true;
    }

    // [P4-7] Set (or clear) a client's phone. RLS/ownership scopes the row: a
    // rep can never edit another rep's client, so a miss is a 404.
    if (method === 'PATCH' && path.startsWith('/clients/') && !path.slice('/clients/'.length).includes('/')) {
      const id = decodeURIComponent(path.slice('/clients/'.length));
      const existing = await clients.findByIdForUser(userId, id);
      if (!existing) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const body = (await readJsonBody(req)) as { phone?: unknown };
      const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
      await clients.setPhone(userId, id, phone);
      sendJson(res, 200, await clients.findByIdForUser(userId, id));
      return true;
    }

    if (method === 'GET' && path === '/clients') {
      const query = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q')?.trim();
      const list = query ? await clients.search(userId, query) : await clients.listByUser(userId);
      sendJson(res, 200, { clients: list });
      return true;
    }

    if (method === 'GET' && path.startsWith('/clients/')) {
      const id = decodeURIComponent(path.slice('/clients/'.length));
      const client = await clients.findByIdForUser(userId, id);
      if (!client) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      sendJson(res, 200, client);
      return true;
    }

    sendJson(res, 405, { error: 'method_not_allowed' });
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
