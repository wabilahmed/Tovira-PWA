import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository } from '../ports/client-repository.js';
import type { MeetingRepository } from '../ports/meeting-repository.js';
import type { MeetingParser } from '../services/meetings/meeting-parser.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';
import { zonedTodayIso, zonedWallClockToInstant } from '../services/time/zone.js';

export interface MeetingRouteDeps {
  auth: AuthService;
  clients: ClientRepository;
  meetings: MeetingRepository;
  parser: MeetingParser;
}

const CREATE_FOR_CLIENT_RE = /^\/clients\/([^/]+)\/meetings$/;
const MEETING_ID_RE = /^\/meetings\/([^/]+)$/;
const CONFIRM_RE = /^\/meetings\/([^/]+)\/confirm$/;

/** Resolve a wall-clock time to an absolute instant in the rep's zone; an already-absolute value
 *  passes through. An unparseable string is kept as-is (it just won't be nudge-eligible). */
function tryResolve(datetime: string, tz: string): string {
  try { return zonedWallClockToInstant(datetime, tz).toISOString(); } catch { return datetime; }
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
  const confirmMatch = method === 'POST' ? CONFIRM_RE.exec(path) : null;
  const editMatch = method === 'PATCH' ? MEETING_ID_RE.exec(path) : null;
  if (!forClient && !isParse && !isCreate && !isList && !delMatch && !confirmMatch && !editMatch) return false;

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
      // NUDGE-TZ: resolve "tomorrow 3pm" against the REP's today, not the server's.
      const tz = await deps.auth.timezoneFor(userId);
      sendJson(res, 200, await deps.parser.parse(userId, text, zonedTodayIso(tz)));
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
      const datetimeInput = typeof body.datetime === 'string' ? body.datetime : null;
      const datetimeRaw = typeof body.datetimeRaw === 'string' && body.datetimeRaw ? body.datetimeRaw : datetimeInput ?? '';
      if (!datetimeInput && !datetimeRaw) {
        sendJson(res, 400, { error: 'validation', message: 'A meeting time is required.' });
        return true;
      }
      // NUDGE-TZ: a wall-clock time ("3pm") is meaningless without a zone. Resolve it to an
      // absolute instant IN THE REP'S ZONE so the meeting — and its 2h-ahead nudge — land on
      // the rep's clock, not the server's. An already-absolute value (Z/offset) passes through.
      const datetime = datetimeInput ? tryResolve(datetimeInput, await deps.auth.timezoneFor(userId)) : datetimeInput;
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

    // MEETING-CREATE: reschedule/edit. A start-time change re-resolves on the rep's clock; the
    // repo leaves nudged_at alone, so a not-yet-nudged meeting follows the new time and an
    // already-nudged one never re-fires (one nudge per meeting). Moving into the past drops it.
    if (editMatch) {
      const body = (await readJsonBody(req)) as { datetime?: unknown; datetimeRaw?: unknown; title?: unknown };
      const patch: { datetime?: string | null; datetimeRaw?: string; title?: string | null } = {};
      if (typeof body.datetime === 'string' || body.datetime === null) {
        patch.datetime = typeof body.datetime === 'string'
          ? tryResolve(body.datetime, await deps.auth.timezoneFor(userId))
          : null;
      }
      if (typeof body.datetimeRaw === 'string') patch.datetimeRaw = body.datetimeRaw;
      if (typeof body.title === 'string' || body.title === null) patch.title = body.title;
      const meeting = await deps.meetings.update(userId, decodeURIComponent(editMatch[1]!), patch);
      sendJson(res, meeting ? 200 : 404, meeting ?? { error: 'not_found' });
      return true;
    }

    // NUDGE-UNCONFIRMED: one-tap confirm of a proposed meeting → confirmed:true, nudge-eligible.
    if (confirmMatch) {
      const meeting = await deps.meetings.confirm(userId, decodeURIComponent(confirmMatch[1]!));
      sendJson(res, meeting ? 200 : 404, meeting ?? { error: 'not_found' });
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
