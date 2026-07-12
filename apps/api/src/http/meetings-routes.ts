import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { MeetingRepository } from '../ports/meeting-repository.js';
import type { MeetingParser } from '../services/meetings/meeting-parser.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';

export interface MeetingRouteDeps {
  auth: AuthService;
  clients: ClientRepository;
  meetings: MeetingRepository;
  parser: MeetingParser;
}

const CREATE_FOR_CLIENT_RE = /^\/clients\/([^/]+)\/meetings$/;
const MEETING_ID_RE = /^\/meetings\/([^/]+)$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function handleMeetingRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: MeetingRouteDeps,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;

  const forClient = method === 'POST' ? CREATE_FOR_CLIENT_RE.exec(path) : null;
  const isParse = method === 'POST' && path === '/meetings/parse';
  const isCreate = method === 'POST' && path === '/meetings';
  const isList = method === 'GET' && path === '/meetings';
  const delMatch = method === 'DELETE' ? MEETING_ID_RE.exec(path) : null;
  if (!forClient && !isParse && !isCreate && !isList && !delMatch) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;

  try {
    if (isParse) {
      const body = (await readJsonBody(req)) as { text?: unknown };
      const text = typeof body.text === 'string' ? body.text : '';
      if (!text.trim()) {
        sendJson(res, 400, { error: 'validation', message: 'Say what to schedule.' });
        return true;
      }
      sendJson(res, 200, await deps.parser.parse(userId, text, todayIso()));
      return true;
    }

    if (forClient || isCreate) {
      const body = (await readJsonBody(req)) as {
        clientId?: unknown;
        datetime?: unknown;
        datetimeRaw?: unknown;
        title?: unknown;
      };
      const clientId = forClient ? decodeURIComponent(forClient[1]!) : String(body.clientId ?? '');
      const client = await deps.clients.findByIdForUser(userId, clientId);
      if (!client) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const datetime = typeof body.datetime === 'string' ? body.datetime : null;
      const datetimeRaw = typeof body.datetimeRaw === 'string' && body.datetimeRaw ? body.datetimeRaw : datetime ?? '';
      if (!datetime && !datetimeRaw) {
        sendJson(res, 400, { error: 'validation', message: 'A meeting time is required.' });
        return true;
      }
      const meeting = await deps.meetings.create(userId, {
        clientId,
        datetime,
        datetimeRaw,
        title: typeof body.title === 'string' ? body.title : null,
        confirmed: true,
      });
      await deps.clients.touch(userId, clientId);
      sendJson(res, 201, meeting);
      return true;
    }

    if (isList) {
      sendJson(res, 200, { meetings: await deps.meetings.listByUser(userId) });
      return true;
    }

    if (delMatch) {
      const ok = await deps.meetings.delete(userId, decodeURIComponent(delMatch[1]!));
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not_found' });
      return true;
    }

    return false;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
