import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository, ClientOutcome } from '../ports/client-repository.js';
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
      const body = (await readJsonBody(req)) as { name?: unknown; phone?: unknown; title?: unknown; email?: unknown };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        sendJson(res, 400, { error: 'validation', message: 'A client name is required.' });
        return true;
      }
      // Stored as entered (P4-7) — we never rewrite it or guess a country code.
      const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
      const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
      sendJson(res, 201, await clients.create(userId, name, phone, title, email));
      return true;
    }

    // [OUTCOME-3 / FOLLOWUP-1] The rep confirm control: won / lost / still open.
    //  - won / lost are real OUTCOME statements → outcome_source='rep', which the nightly silence rule
    //    (OUTCOME-2) must never overwrite.
    //  - "still open" is a statement about the PRESENT, not the outcome. It resets the going-quiet
    //    clock (a snooze) and leaves outcome_source UNSET, so the client stays eligible for inference
    //    later — a rep saying a deal is alive in March is not saying it can never be inferred lost in
    //    December. Source is left unset (null) rather than 'inferred': 'inferred' would falsely
    //    attribute a rep tap to the system, and null == "no outcome on record" is the honest state.
    // Reversible — a rep can POST a different outcome later.
    if (method === 'POST' && path.startsWith('/clients/') && path.endsWith('/outcome')) {
      const id = decodeURIComponent(path.slice('/clients/'.length, -'/outcome'.length));
      const existing = await clients.findByIdForUser(userId, id);
      if (!existing) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const body = (await readJsonBody(req)) as { outcome?: unknown };
      const choice = typeof body.outcome === 'string' ? body.outcome : '';
      const mapped: ClientOutcome | null =
        choice === 'won' ? 'won' : choice === 'lost' ? 'lost_confirmed' : choice === 'open' ? 'open' : null;
      if (mapped === null) {
        sendJson(res, 400, { error: 'validation', message: "outcome must be 'won', 'lost', or 'open'." });
        return true;
      }
      if (mapped === 'open') {
        await clients.clearOutcome(userId, id); // snooze: back to the untouched default (source unset)
        await clients.touch(userId, id);        // reset the going-quiet clock
      } else {
        await clients.setOutcome(userId, id, mapped, 'rep', Date.now());
      }
      sendJson(res, 200, await clients.findByIdForUser(userId, id));
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
