import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import type { AuthService } from './services/auth/auth-service.js';
import type { ClientRepository } from './ports/client-repository.js';
import type { NoteRepository } from './ports/note-repository.js';
import type { Storage } from './ports/storage.js';
import type { TranscriptionService } from './services/transcription/transcription-service.js';
import type { ExtractionService } from './services/extraction/extraction-service.js';
import type { FollowUpService } from './services/followup/follow-up-service.js';
import type { FactsRepository } from './ports/facts-repository.js';
import type { CorrectionRepository } from './ports/correction-repository.js';
import type { ExtractionLogRepository } from './ports/extraction-log-repository.js';
import type { BriefService } from './services/brief/brief-service.js';
import type { MeetingRepository } from './ports/meeting-repository.js';
import type { MeetingParser } from './services/meetings/meeting-parser.js';
import type { NotificationRepository } from './ports/notification-repository.js';
import type { ScanService, ScanConfig } from './services/scan/scan-service.js';
import type { PushSender, PushSubscriptionRepository } from './ports/push.js';
import type { CardScanner } from './ports/card-scanner.js';
import type { ImageRepository } from './ports/image-repository.js';
import type { HeroService } from './services/hero/hero-service.js';
import type { BillingService } from './services/billing/billing-service.js';
import type { AccountService } from './services/account/account-service.js';
import type { ActivationService } from './services/analytics/activation-service.js';
import { handleAuthRoute } from './http/auth-routes.js';
import { handleProactiveRoute } from './http/proactive-routes.js';
import { handlePushRoute } from './http/push-routes.js';
import { handleClientRoute } from './http/clients-routes.js';
import { handleNoteRoute } from './http/notes-routes.js';
import { handleFactsRoute } from './http/facts-routes.js';
import { handleBriefRoute } from './http/brief-routes.js';
import { handleMeetingRoute } from './http/meetings-routes.js';
import { handleInsightsRoute } from './http/insights-routes.js';
import { handleCardRoute } from './http/cards-routes.js';
import { handleImageRoute } from './http/images-routes.js';
import { handleHeroRoute } from './http/hero-routes.js';
import { handleBillingRoute } from './http/billing-routes.js';
import { handleAccountRoute } from './http/account-routes.js';
import { handleOnboardingRoute } from './http/onboarding-routes.js';
import { sendJson } from './http/helpers.js';

export interface ApiDeps {
  pool: Pool;
  auth: AuthService;
  clients: ClientRepository;
  notes: NoteRepository;
  storage: Storage;
  transcription: TranscriptionService;
  extraction: ExtractionService;
  followUp: FollowUpService;
  facts: FactsRepository;
  corrections: CorrectionRepository;
  extractionLog: ExtractionLogRepository;
  brief: BriefService;
  meetings: MeetingRepository;
  meetingParser: MeetingParser;
  notifications: NotificationRepository;
  scan: ScanService;
  scanConfig: ScanConfig;
  pushSubscriptions: PushSubscriptionRepository;
  pushSender: PushSender;
  cardScanner: CardScanner;
  images: ImageRepository;
  hero: HeroService;
  billing: BillingService;
  account: AccountService;
  activation: ActivationService;
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

      if (await handleAuthRoute(request, response, deps.auth, { cookieSecure, onSignup: (userId, email) => deps.billing.onSignup(userId, email, Date.now()) })) return;
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
          followUp: deps.followUp,
        })
      )
        return;
      if (
        await handlePushRoute(request, response, {
          auth: deps.auth,
          subscriptions: deps.pushSubscriptions,
          sender: deps.pushSender,
        })
      )
        return;
      if (
        await handleFactsRoute(request, response, {
          auth: deps.auth,
          facts: deps.facts,
          corrections: deps.corrections,
          extractionLog: deps.extractionLog,
        })
      )
        return;
      if (await handleBriefRoute(request, response, { auth: deps.auth, brief: deps.brief, billing: deps.billing, activation: deps.activation })) return;
      if (await handleInsightsRoute(request, response, { auth: deps.auth, notes: deps.notes })) return;
      if (await handleCardRoute(request, response, { auth: deps.auth, scanner: deps.cardScanner })) return;
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
      if (await handleImageRoute(request, response, { auth: deps.auth, clients: deps.clients, images: deps.images, storage: deps.storage })) return;
      if (await handleHeroRoute(request, response, { auth: deps.auth, hero: deps.hero })) return;
      if (await handleBillingRoute(request, response, { auth: deps.auth, billing: deps.billing })) return;
      if (await handleAccountRoute(request, response, { auth: deps.auth, account: deps.account })) return;
      if (await handleOnboardingRoute(request, response, { auth: deps.auth, clients: deps.clients, notes: deps.notes })) return;
      if (await handleClientRoute(request, response, deps.auth, deps.clients)) return;

      if (request.method === 'GET' && url === '/') {
        sendJson(response, 200, { name: 'tovira-api', status: 'ok' });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    }
  });
}
