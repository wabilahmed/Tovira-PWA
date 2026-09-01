import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import type { AuthService } from './services/auth/auth-service.js';
import type { RateLimiter } from './services/security/rate-limiter.js';
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
import type { PushDispatchService } from './services/push/push-dispatch-service.js';
import type { JobRun, JobRunStore } from './ports/scheduled-jobs.js';
import type { CardScanner } from './ports/card-scanner.js';
import type { ImageRepository } from './ports/image-repository.js';
import type { HeroService } from './services/hero/hero-service.js';
import type { PrioritiesService } from './services/hero/priorities-service.js';
import type { BillingService } from './services/billing/billing-service.js';
import type { AccountService } from './services/account/account-service.js';
import type { ActivationService } from './services/analytics/activation-service.js';
import { handleAuthRoute } from './http/auth-routes.js';
import type { AccountEmailService } from './services/email/account-email-service.js';
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
import { handleBookScanRoute } from './http/book-scan-routes.js';
import type { BookScanService } from './services/book-scan/book-scan-service.js';
import { handleRecallRoute } from './http/recall-routes.js';
import type { RecallService } from './services/recall/recall-service.js';
import { handleCorpusRoute } from './http/corpus-routes.js';
import type { CorpusStatsService } from './services/corpus/corpus-service.js';
import { handleMondayRoute } from './http/monday-routes.js';
import type { MondayDigestService } from './services/monday/monday-service.js';
import { handleLedgerRoute } from './http/ledger-routes.js';
import type { LedgerService } from './services/ledger/ledger-service.js';
import { handleShareCardRoute } from './http/share-card-routes.js';
import type { ReferralService } from './services/referral/referral-service.js';
import { handleBillingRoute } from './http/billing-routes.js';
import { handleAccountRoute } from './http/account-routes.js';
import { handleOnboardingRoute } from './http/onboarding-routes.js';
import { sendJson } from './http/helpers.js';

/** Shape each job's last-run for /health: ISO time + age so "is it alive" is at a glance. */
function summarizeJobs(jobs: JobRun[], nowMs: number) {
  return jobs.map((j) => ({
    name: j.name,
    ok: j.ok,
    lastRunAt: new Date(j.lastRunAt).toISOString(),
    ageSeconds: Math.max(0, Math.round((nowMs - j.lastRunAt) / 1000)),
    ...(j.error ? { error: j.error } : {}),
  }));
}

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
  pushDispatch: PushDispatchService;
  cardScanner: CardScanner;
  images: ImageRepository;
  hero: HeroService;
  priorities: PrioritiesService;
  billing: BillingService;
  account: AccountService;
  activation: ActivationService;
  bookScan: BookScanService;
  recall: RecallService;
  corpus: CorpusStatsService;
  monday: MondayDigestService;
  ledger: LedgerService;
  referral: ReferralService;
  accountEmail: AccountEmailService;
  appBaseUrl: string;
  /** Which pluggable adapters are live vs stub (health/observability). */
  adapterModes?: Record<string, 'live' | 'stub'>;
  /** Last-run records for the scheduled brain, surfaced in /health (SWEEP-NEVER-RUNS). */
  jobRuns?: JobRunStore;
  cookieSecure?: boolean;
  /** Optional brute-force throttle for /auth/login (defaults to none in tests). */
  loginLimiter?: RateLimiter;
}

/**
 * The Phase 0 API: health, auth (signup/login/logout), and a protected /me.
 * Everything cloud-swappable is injected (pool, auth) — the server just routes.
 */
export function createApiServer(deps: ApiDeps): Server {
  const cookieSecure = deps.cookieSecure ?? false;

  return createServer((req, res) => {
    void dispatch(req, res).catch((err: unknown) => {
      // Never leak internals (no stack/message in the body); never leave a hanging
      // socket. MALFORMED-ID sweep: a malformed path id reaches Postgres as an
      // invalid uuid (SQLSTATE 22P02) and would otherwise surface as a 500. Map it
      // to a generic 400 for EVERY id-taking route at once — no route can forget.
      console.error(`[api] unhandled: ${err instanceof Error ? err.message : String(err)}`);
      const code = (err as { code?: unknown })?.code;
      if (!res.headersSent) {
        if (code === '22P02') sendJson(res, 400, { error: 'bad_request', message: 'Invalid identifier.' });
        else sendJson(res, 500, { error: 'internal_error' });
      }
    });

    async function dispatch(
      request: typeof req,
      response: typeof res,
    ): Promise<void> {
      // Behind CloudFront the PWA calls the API under /api/* (a single cache
      // behavior forwards that prefix to the ALB). Strip it so routing is
      // identical whether the request came in prefixed or same-origin/local.
      // The ALB/ECS health check hits /health directly and is unaffected.
      if (request.url) {
        const stripped = request.url.replace(/^\/api(?=\/|\?|$)/, '');
        request.url = stripped === '' ? '/' : stripped;
      }
      const url = (request.url ?? '/').split('?')[0];

      if (request.method === 'GET' && (url === '/health' || url === '/healthz')) {
        try {
          await deps.pool.query('SELECT 1');
          // adapters: which pluggable providers are live vs stub, so "staging is
          // representative" is verifiable rather than assumed (STAGING-EMBEDDER).
          // jobs: the scheduled brain's last-run per job, so "the brain is running"
          // is checkable, not assumed (SWEEP-NEVER-RUNS). A jobs-read failure omits
          // the field rather than flapping the ALB check — SELECT 1 already gates liveness.
          const jobs = deps.jobRuns ? await deps.jobRuns.list().catch(() => undefined) : undefined;
          sendJson(response, 200, {
            status: 'ok',
            ...(deps.adapterModes ? { adapters: deps.adapterModes } : {}),
            ...(jobs ? { jobs: summarizeJobs(jobs, Date.now()) } : {}),
          });
        } catch {
          sendJson(response, 503, { status: 'degraded', reason: 'database unavailable' });
        }
        return;
      }

      if (await handleAuthRoute(request, response, deps.auth, {
        cookieSecure,
        appBaseUrl: deps.appBaseUrl,
        onSignup: async (userId, email) => {
          await deps.billing.onSignup(userId, email, Date.now());
          // Best-effort welcome — never on the signup critical path (an email
          // must not slow signup or make its wall-clock timing depend on the
          // mailer). Idempotent, so a missed one can be re-sent. Carries the
          // email-confirmation link (EMAIL-VERIFY); a failed token mint just
          // sends the welcome without it.
          void (async () => {
            const [ent, token] = await Promise.all([
              deps.billing.entitlement(userId, Date.now()),
              deps.auth.createEmailVerification(userId).catch(() => undefined),
            ]);
            const verifyUrl = token ? `${deps.appBaseUrl}/verify-email?token=${encodeURIComponent(token)}` : undefined;
            await deps.accountEmail.sendWelcome(userId, email, ent.trialEndsAt, verifyUrl);
          })().catch(() => undefined);
        },
        onReferral: (code, userId, email) => deps.referral.apply(code, userId, email).then(() => undefined),
        sendResetEmail: (to, resetUrl) => deps.accountEmail.sendPasswordReset(to, resetUrl),
        sendVerifyEmail: (to, verifyUrl) => deps.accountEmail.sendVerification(to, verifyUrl),
        loginLimiter: deps.loginLimiter,
      })) return;
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
          notifications: deps.notifications,
          ledger: deps.ledger,
          billing: deps.billing,
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
          ledger: deps.ledger,
        })
      )
        return;
      if (await handleBriefRoute(request, response, { auth: deps.auth, brief: deps.brief, billing: deps.billing, activation: deps.activation, meetings: deps.meetings, ledger: deps.ledger })) return;
      if (await handleInsightsRoute(request, response, { auth: deps.auth, notes: deps.notes })) return;
      if (await handleCardRoute(request, response, { auth: deps.auth, scanner: deps.cardScanner, billing: deps.billing })) return;
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
          pushDispatch: deps.pushDispatch,
        })
      )
        return;
      if (await handleImageRoute(request, response, { auth: deps.auth, clients: deps.clients, images: deps.images, storage: deps.storage })) return;
      if (await handleHeroRoute(request, response, { auth: deps.auth, hero: deps.hero, priorities: deps.priorities, billing: deps.billing })) return;
      if (await handleBookScanRoute(request, response, { auth: deps.auth, bookScan: deps.bookScan, billing: deps.billing })) return;
      if (await handleRecallRoute(request, response, { auth: deps.auth, recall: deps.recall, billing: deps.billing })) return;
      if (await handleCorpusRoute(request, response, { auth: deps.auth, corpus: deps.corpus })) return;
      if (await handleMondayRoute(request, response, { auth: deps.auth, monday: deps.monday, billing: deps.billing })) return;
      if (await handleLedgerRoute(request, response, { auth: deps.auth, ledger: deps.ledger, clients: deps.clients })) return;
      if (await handleShareCardRoute(request, response, { auth: deps.auth, bookScan: deps.bookScan })) return;
      if (await handleBillingRoute(request, response, { auth: deps.auth, billing: deps.billing, clients: deps.clients, notes: deps.notes })) return;
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
