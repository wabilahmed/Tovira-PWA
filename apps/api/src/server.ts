import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import type { AuthService } from './services/auth/auth-service.js';
import type { ClientRepository } from './ports/client-repository.js';
import type { NoteRepository } from './ports/note-repository.js';
import type { Storage } from './ports/storage.js';
import type { TranscriptionService } from './services/transcription/transcription-service.js';
import type { ExtractionService } from './services/extraction/extraction-service.js';
import type { FactsRepository } from './ports/facts-repository.js';
import type { CorrectionRepository } from './ports/correction-repository.js';
import type { BriefService } from './services/brief/brief-service.js';
import type { MeetingRepository } from './ports/meeting-repository.js';
import type { MeetingParser } from './services/meetings/meeting-parser.js';
import type { NotificationRepository } from './ports/notification-repository.js';
import type { ScanService, ScanConfig } from './services/scan/scan-service.js';
import { handleAuthRoute } from './http/auth-routes.js';
import { handleProactiveRoute } from './http/proactive-routes.js';
import { handleClientRoute } from './http/clients-routes.js';
import { handleNoteRoute } from './http/notes-routes.js';
import { handleFactsRoute } from './http/facts-routes.js';
import { handleBriefRoute } from './http/brief-routes.js';
import { handleMeetingRoute } from './http/meetings-routes.js';
import { sendJson } from './http/helpers.js';

export interface ApiDeps {
  pool: Pool;
  auth: AuthService;
  clients: ClientRepository;
  notes: NoteRepository;
  storage: Storage;
  transcription: TranscriptionService;
  extraction: ExtractionService;
  facts: FactsRepository;
  corrections: CorrectionRepository;
  brief: BriefService;
  meetings: MeetingRepository;
  meetingParser: MeetingParser;
  notifications: NotificationRepository;
  scan: ScanService;
  scanConfig: ScanConfig;
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
      // Notes routes are matched before the generic client routes so
      // /clients/:id/notes/* isn't misread as /clients/:id.
      if (
        await handleNoteRoute(request, response, {
          auth: deps.auth,
          clients: deps.clients,
          notes: deps.notes,
          storage: deps.storage,
          transcription: deps.transcription,
          extraction: deps.extraction,
        })
      )
        return;
      if (
        await handleFactsRoute(request, response, {
          auth: deps.auth,
          facts: deps.facts,
          corrections: deps.corrections,
        })
      )
        return;
      if (await handleBriefRoute(request, response, { auth: deps.auth, brief: deps.brief })) return;
      if (
        await handleMeetingRoute(request, response, {
          auth: deps.auth,
          clients: deps.clients,
          meetings: deps.meetings,
          parser: deps.meetingParser,
        })
      )
        return;
      if (
        await handleProactiveRoute(request, response, {
          auth: deps.auth,
          clients: deps.clients,
          notifications: deps.notifications,
          scan: deps.scan,
          scanConfig: deps.scanConfig,
        })
      )
        return;
      if (await handleClientRoute(request, response, deps.auth, deps.clients)) return;

      if (request.method === 'GET' && url === '/') {
        sendJson(response, 200, { name: 'tovira-api', status: 'ok' });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    }
  });
}
