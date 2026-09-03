import type { Pool } from 'pg';
import type { AppConfig, AiTaskClass } from './config.js';
import type { ModelClient } from './ports/model.js';
import type { AuthProvider } from './ports/auth.js';
import type { Storage } from './ports/storage.js';
import type { Scheduler } from './ports/scheduler.js';
import type { AdvisoryLock, JobRunStore } from './ports/scheduled-jobs.js';
import { PgJobRunStore, PgAdvisoryLock } from './adapters/scheduler/pg-scheduled-jobs.js';
import { InMemoryJobRunStore, InMemoryAdvisoryLock } from './adapters/scheduler/in-memory-scheduled-jobs.js';
import type { UserRepository } from './ports/user-repository.js';
import type { SessionRepository } from './ports/session-repository.js';
import { StubModelClient } from './adapters/model/stub.js';
import { AnthropicModelClient } from './adapters/model/anthropic.js';
import { MeteredModelClient } from './adapters/model/metered.js';
import { StubAuthProvider } from './adapters/auth/stub.js';
import { FsStorage } from './adapters/storage/fs.js';
import { LocalScheduler } from './adapters/scheduler/local.js';
import { InMemoryUserRepository } from './adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from './adapters/auth/in-memory-session-repository.js';
import { InMemoryPasswordResetRepository } from './adapters/auth/in-memory-password-reset-repository.js';
import { PgPasswordResetRepository } from './adapters/auth/pg-password-reset-repository.js';
import type { PasswordResetRepository } from './ports/password-reset-repository.js';
import { InMemoryEmailVerificationRepository } from './adapters/auth/in-memory-email-verification-repository.js';
import { PgEmailVerificationRepository } from './adapters/auth/pg-email-verification-repository.js';
import type { EmailVerificationRepository } from './ports/email-verification-repository.js';
import type { EmailSender } from './ports/email.js';
import { StubEmailSender } from './adapters/email/stub-email-sender.js';
import { SesEmailSender } from './adapters/email/ses-email-sender.js';
import { ResendEmailSender } from './adapters/email/resend-email-sender.js';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import type { EmailLogRepository } from './ports/email-log-repository.js';
import { InMemoryEmailLogRepository } from './adapters/email/in-memory-email-log-repository.js';
import { PgEmailLogRepository } from './adapters/email/pg-email-log-repository.js';
import { AccountEmailService } from './services/email/account-email-service.js';
import { PgUserRepository } from './adapters/auth/pg-user-repository.js';
import { PgSessionRepository } from './adapters/auth/pg-session-repository.js';
import { AuthService } from './services/auth/auth-service.js';
import { ScryptHasher } from './services/auth/password.js';
import type { ClientRepository } from './ports/client-repository.js';
import { InMemoryClientRepository } from './adapters/clients/in-memory-client-repository.js';
import { PgClientRepository } from './adapters/clients/pg-client-repository.js';
import type { InventoryRepository } from './ports/inventory-repository.js';
import { InMemoryInventoryRepository } from './adapters/inventory/in-memory-inventory-repository.js';
import { PgInventoryRepository } from './adapters/inventory/pg-inventory-repository.js';
import { InventoryService } from './services/inventory/inventory-service.js';
import type { NoteRepository } from './ports/note-repository.js';
import { InMemoryNoteRepository } from './adapters/notes/in-memory-note-repository.js';
import { PgNoteRepository } from './adapters/notes/pg-note-repository.js';
import type { Transcriber } from './ports/transcriber.js';
import { StubTranscriber } from './adapters/transcription/stub.js';
import { GroqTranscriber } from './adapters/transcription/groq.js';
import { TranscriptionService } from './services/transcription/transcription-service.js';
import type { FactsRepository } from './ports/facts-repository.js';
import { InMemoryFactsRepository } from './adapters/facts/in-memory-facts-repository.js';
import { PgFactsRepository } from './adapters/facts/pg-facts-repository.js';
import type { Embedder } from './ports/embedder.js';
import { StubEmbedder } from './adapters/embedding/stub.js';
import { BedrockEmbedder } from './adapters/embedding/bedrock.js';
import { ExtractionService } from './services/extraction/extraction-service.js';
import { RecallService } from './services/recall/recall-service.js';
import { LedgerService } from './services/ledger/ledger-service.js';
import type { PrioritiesRepository } from './ports/priorities-repository.js';
import { InMemoryPrioritiesRepository } from './adapters/priorities/in-memory-priorities-repository.js';
import { PgPrioritiesRepository } from './adapters/priorities/pg-priorities-repository.js';
import { InMemoryLedgerRepository } from './adapters/ledger/in-memory-ledger-repository.js';
import { PgLedgerRepository } from './adapters/ledger/pg-ledger-repository.js';
import { BillingModelRouter, type ModelRouter } from './services/extraction/model-router.js';
import type { ExtractionLimiter } from './services/extraction/limiter.js';
import type { ExtractionLogRepository } from './ports/extraction-log-repository.js';
import { InMemoryExtractionLogRepository } from './adapters/logs/in-memory-extraction-log-repository.js';
import { PgExtractionLogRepository } from './adapters/logs/pg-extraction-log-repository.js';
import { BriefService } from './services/brief/brief-service.js';
import { FollowUpService } from './services/followup/follow-up-service.js';
import type { CorrectionRepository } from './ports/correction-repository.js';
import { InMemoryCorrectionRepository } from './adapters/corrections/in-memory-correction-repository.js';
import { PgCorrectionRepository } from './adapters/corrections/pg-correction-repository.js';
import type { MeetingRepository } from './ports/meeting-repository.js';
import { InMemoryMeetingRepository } from './adapters/meetings/in-memory-meeting-repository.js';
import { PgMeetingRepository } from './adapters/meetings/pg-meeting-repository.js';
import { MeetingParser } from './services/meetings/meeting-parser.js';
import type { NotificationRepository } from './ports/notification-repository.js';
import { InMemoryNotificationRepository } from './adapters/notifications/in-memory-notification-repository.js';
import { PgNotificationRepository } from './adapters/notifications/pg-notification-repository.js';
import { ScanService, type ScanConfig } from './services/scan/scan-service.js';
import type { PushSender, PushSubscriptionRepository, PushBudgetRepository } from './ports/push.js';
import { PushDispatchService } from './services/push/push-dispatch-service.js';
import { InMemoryPushBudgetRepository } from './adapters/push/in-memory-push-budget-repository.js';
import { PgPushBudgetRepository } from './adapters/push/pg-push-budget-repository.js';
import { StubPushSender } from './adapters/push/stub-sender.js';
import { WebPushSender } from './adapters/push/webpush-sender.js';
import { InMemoryPushSubscriptionRepository } from './adapters/push/in-memory-push-subscription-repository.js';
import { PgPushSubscriptionRepository } from './adapters/push/pg-push-subscription-repository.js';
import type { ImageRepository } from './ports/image-repository.js';
import { InMemoryImageRepository } from './adapters/images/in-memory-image-repository.js';
import { PgImageRepository } from './adapters/images/pg-image-repository.js';
import { HeroService } from './services/hero/hero-service.js';
import { BillingService, type BillingEmailHook } from './services/billing/billing-service.js';
import type { SubscriptionRepository, TrialGrantRepository, WebhookEventRepository } from './ports/billing.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from './adapters/billing/in-memory.js';
import { PgSubscriptionRepository, PgTrialGrantRepository, PgWebhookEventRepository } from './adapters/billing/pg.js';
import { StubStripeGateway } from './adapters/billing/stub-stripe.js';
import { StripeGatewayImpl } from './adapters/billing/stripe-gateway.js';
import type { StripeGateway } from './ports/billing.js';
import { AccountService } from './services/account/account-service.js';
import { ActivationService } from './services/analytics/activation-service.js';
import { PgActivationRepository, LogAnalytics } from './adapters/analytics/pg.js';
import { InMemoryActivationRepository, InMemoryAnalytics } from './adapters/analytics/in-memory.js';

/**
 * Composition root. The ONLY place that names concrete adapters — it maps config
 * to implementations so business logic never imports a vendor SDK. Swapping a
 * provider (stub → Anthropic, fs → S3, …) happens here, driven by config.
 */

export interface Services {
  model: ModelClient;
  auth: AuthProvider;
  storage: Storage;
  scheduler: Scheduler;
}

/** Precomputed daily-priorities cache (cost-guard #3, P4b-3). */
export function createPrioritiesRepository(config: AppConfig, pool?: Pool): PrioritiesRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgPrioritiesRepository(pool);
  }
  return new InMemoryPrioritiesRepository();
}

/** Recovered Value Ledger (P4-11). */
export function createLedgerService(config: AppConfig, pool?: Pool): LedgerService {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new LedgerService(new PgLedgerRepository(pool));
  }
  return new LedgerService(new InMemoryLedgerRepository());
}

/** Conversational recall (P4-8): embed + retrieve top-k + grounded answer. */
export function createRecallService(config: AppConfig, notes: NoteRepository): RecallService {
  return new RecallService(createEmbedder(config), notes, createModelClient(config, 'recall'));
}

/**
 * Build a model client for a given AI task class (P1-9 hybrid routing). The
 * class only selects the MODEL id — it never touches the system prompt, so the
 * extraction cacheable prefix stays byte-identical and Haiku/Sonnet keep
 * separate caches. Defaults to `extraction` (Sonnet) for backward compatibility.
 */
export function createModelClient(config: AppConfig, taskClass: AiTaskClass = 'extraction'): ModelClient {
  const model = config.models[taskClass];
  const inner: ModelClient =
    config.modelProvider === 'anthropic'
      ? new AnthropicModelClient({ apiKey: config.anthropicApiKey ?? '', baseUrl: config.anthropicBaseUrl, model })
      : new StubModelClient();
  // CACHE-1: meter every call's cache outcome per task class (→ /health, observability).
  return new MeteredModelClient(inner, taskClass, model);
}

export function createServices(config: AppConfig): Services {
  return {
    model: createModelClient(config),
    auth: new StubAuthProvider(),
    storage: new FsStorage(config.storageDir),
    scheduler: new LocalScheduler(),
  };
}

/** Build the auth service, selecting the user/session store from config. */
export function createAuthService(config: AppConfig, pool?: Pool): AuthService {
  let users: UserRepository;
  let sessions: SessionRepository;
  let passwordResets: PasswordResetRepository;
  let emailVerifications: EmailVerificationRepository;
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    users = new PgUserRepository(pool);
    sessions = new PgSessionRepository(pool);
    passwordResets = new PgPasswordResetRepository(pool);
    emailVerifications = new PgEmailVerificationRepository(pool);
  } else {
    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository();
    passwordResets = new InMemoryPasswordResetRepository();
    emailVerifications = new InMemoryEmailVerificationRepository();
  }
  return new AuthService({
    users,
    sessions,
    passwordResets,
    emailVerifications,
    hasher: new ScryptHasher(),
    sessionTtlMs: config.sessionTtlHours * 60 * 60 * 1000,
  });
}

/** Build the client repository, selecting the store from config (RLS-backed on pg). */
export function createClientRepository(config: AppConfig, pool?: Pool): ClientRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgClientRepository(pool);
  }
  return new InMemoryClientRepository();
}

/** Build the inventory repository, selecting the store from config (RLS-backed on pg). */
export function createInventoryRepository(config: AppConfig, pool?: Pool): InventoryRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgInventoryRepository(pool);
  }
  return new InMemoryInventoryRepository();
}

/** Build the inventory service (repo + embedder — embeds each item on save; no Claude — plus
 *  the ledger for the suggested-then-bought credit). */
export function createInventoryService(repo: InventoryRepository, ledger: LedgerService, config: AppConfig): InventoryService {
  return new InventoryService(repo, createEmbedder(config), ledger);
}

/** Build the note repository, selecting the store from config (RLS-backed on pg). */
export function createNoteRepository(config: AppConfig, pool?: Pool): NoteRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgNoteRepository(pool);
  }
  return new InMemoryNoteRepository();
}

/** Blob storage for audio + images (filesystem locally, S3 in prod). */
export function createStorage(config: AppConfig): Storage {
  return new FsStorage(config.storageDir);
}

/** Speech-to-text: stub locally, Groq/Whisper when configured. */
export function createTranscriber(config: AppConfig): Transcriber {
  if (config.transcriberProvider === 'groq') {
    try {
      return new GroqTranscriber({
        apiKey: config.groqApiKey ?? '',
        baseUrl: config.groqBaseUrl,
        model: config.groqModel,
      });
    } catch (err) {
      console.warn(`[transcribe] groq disabled (missing/invalid key: ${err instanceof Error ? err.message : String(err)}). Add a real key to enable voice notes.`);
      return new StubTranscriber();
    }
  }
  return new StubTranscriber();
}

export function createTranscriptionService(
  config: AppConfig,
  notes: NoteRepository,
  storage: Storage,
): TranscriptionService {
  return new TranscriptionService(createTranscriber(config), notes, storage);
}

/** The extracted spine store (promises), RLS-backed on pg. */
export function createFactsRepository(config: AppConfig, pool?: Pool): FactsRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgFactsRepository(pool);
  }
  return new InMemoryFactsRepository();
}

/** Text embeddings: stub locally, Bedrock (Titan v2) when configured. */
export function createEmbedder(config: AppConfig): Embedder {
  if (config.embedderProvider === 'bedrock') {
    return new BedrockEmbedder({ region: config.bedrockRegion, modelId: config.embedModel, dimension: config.embedDim });
  }
  return new StubEmbedder(config.embedDim);
}

/** The extraction training log (P1-8), RLS-backed on pg. */
export function createExtractionLogRepository(config: AppConfig, pool?: Pool): ExtractionLogRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgExtractionLogRepository(pool);
  }
  return new InMemoryExtractionLogRepository();
}

export function createExtractionService(
  config: AppConfig,
  clients: ClientRepository,
  notes: NoteRepository,
  facts: FactsRepository,
  logs: ExtractionLogRepository,
  corrections?: CorrectionRepository,
  router?: ModelRouter,
  limiter?: ExtractionLimiter,
  meetings?: MeetingRepository,
  timezoneFor?: (userId: string) => Promise<string>,
): ExtractionService {
  const modelId = config.modelProvider === 'anthropic' ? config.anthropicModel : 'stub';
  return new ExtractionService(createModelClient(config), clients, notes, facts, createEmbedder(config), logs, modelId, corrections, router, limiter, config.extractionCacheTtl, meetings, timezoneFor);
}

/**
 * Per-account extraction model router (P5-7): trial → Sonnet, paid → the
 * P1-9-selected production model. Only meaningful for the real (anthropic)
 * provider; the local stub path routes nowhere (returns undefined).
 */
export function createExtractionModelRouter(
  config: AppConfig,
  statusOf: (userId: string, nowMs: number) => Promise<string>,
): ModelRouter | undefined {
  if (config.modelProvider !== 'anthropic') return undefined;
  const make = (model: string) =>
    new AnthropicModelClient({ apiKey: config.anthropicApiKey ?? '', baseUrl: config.anthropicBaseUrl, model });
  return new BillingModelRouter(
    statusOf,
    { model: make(config.anthropicModel), modelId: config.anthropicModel },
    { model: make('claude-sonnet-5'), modelId: 'claude-sonnet-5' },
  );
}

/** The rep-corrections training log (P2-3), RLS-backed on pg. */
export function createCorrectionRepository(config: AppConfig, pool?: Pool): CorrectionRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgCorrectionRepository(pool);
  }
  return new InMemoryCorrectionRepository();
}

/** The rep's calendar store (P3-1), RLS-backed on pg. */
export function createMeetingRepository(config: AppConfig, pool?: Pool): MeetingRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgMeetingRepository(pool);
  }
  return new InMemoryMeetingRepository();
}

/** Natural-language meeting parser (uses the model + client search). */
export function createMeetingParser(config: AppConfig, clients: ClientRepository): MeetingParser {
  return new MeetingParser(createModelClient(config), clients);
}

/** Generated notifications store (P3), RLS-backed on pg. */
export function createNotificationRepository(config: AppConfig, pool?: Pool): NotificationRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgNotificationRepository(pool);
  }
  return new InMemoryNotificationRepository();
}

export function createScanService(
  clients: ClientRepository,
  meetings: MeetingRepository,
  facts: FactsRepository,
  notifications: NotificationRepository,
  notes: NoteRepository,
): ScanService {
  return new ScanService(clients, meetings, facts, notifications, notes);
}

/** Web Push subscriptions (P3-6), RLS-backed on pg. */
export function createPushSubscriptionRepository(config: AppConfig, pool?: Pool): PushSubscriptionRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgPushSubscriptionRepository(pool);
  }
  return new InMemoryPushSubscriptionRepository();
}

/** Push delivery: stub locally; real VAPID/web-push when configured. */
export function createPushSender(config: AppConfig): PushSender {
  if (config.pushProvider === 'webpush') {
    try {
      return new WebPushSender({ publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey, subject: config.vapidSubject });
    } catch (err) {
      // Placeholder/blank/invalid VAPID keys must not crash boot — disable push.
      console.warn(`[push] web push disabled (invalid VAPID keys: ${err instanceof Error ? err.message : String(err)}). Add real keys to enable notifications.`);
      return new StubPushSender();
    }
  }
  return new StubPushSender();
}

/** The silence-budget ledger (max 2 pushes/rep/day), RLS-free system table on pg. */
export function createPushBudgetRepository(config: AppConfig, pool?: Pool): PushBudgetRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgPushBudgetRepository(pool);
  }
  return new InMemoryPushBudgetRepository();
}

/** The push send path: records every alert in-app, pushes only the loudest few. */
export function createPushDispatchService(
  sender: PushSender,
  subs: PushSubscriptionRepository,
  notifications: NotificationRepository,
  budget: PushBudgetRepository,
): PushDispatchService {
  return new PushDispatchService(sender, subs, notifications, budget);
}

/** Per-client gallery images (P4-6), RLS-backed on pg. */
export function createImageRepository(config: AppConfig, pool?: Pool): ImageRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgImageRepository(pool);
  }
  return new InMemoryImageRepository();
}

export function createHeroService(config: AppConfig, clients: ClientRepository, facts: FactsRepository, meetings: MeetingRepository, notes: NoteRepository): HeroService {
  return new HeroService({ clients, facts, meetings, notes }, { minClients: config.heroMinClients, minNotes: config.heroMinNotes }, config.coldThresholdDays);
}

export function createBillingService(config: AppConfig, pool?: Pool, emailHook?: BillingEmailHook): BillingService {
  let subs: SubscriptionRepository;
  let trials: TrialGrantRepository;
  let events: WebhookEventRepository;
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    subs = new PgSubscriptionRepository(pool);
    trials = new PgTrialGrantRepository(pool);
    events = new PgWebhookEventRepository(pool);
  } else {
    subs = new InMemorySubscriptionRepository();
    trials = new InMemoryTrialGrantRepository();
    events = new InMemoryWebhookEventRepository();
  }
  const stripe: StripeGateway = config.stripeSecretKey
    ? new StripeGatewayImpl({ secretKey: config.stripeSecretKey, webhookSecret: config.stripeWebhookSecret, priceId: config.stripePriceId, annualPriceId: config.stripeAnnualPriceId, successUrl: config.stripeSuccessUrl, cancelUrl: config.stripeCancelUrl })
    : new StubStripeGateway(config.stripeWebhookSecret);
  return new BillingService(subs, trials, events, stripe, config.trialDays, emailHook);
}

export function createAccountService(auth: AuthService, clients: ClientRepository, notes: NoteRepository, facts: FactsRepository, meetings: MeetingRepository, images: ImageRepository, onDeleted?: (userId: string, email: string) => Promise<void>): AccountService {
  // On Postgres, deleting the user cascades all data (FKs) — no explicit purge list.
  return new AccountService(auth, clients, notes, facts, meetings, images, [], onDeleted);
}

export function createActivationService(config: AppConfig, pool?: Pool): ActivationService {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new ActivationService(new PgActivationRepository(pool), new LogAnalytics());
  }
  return new ActivationService(new InMemoryActivationRepository(), new InMemoryAnalytics());
}

/**
 * The pre-meeting nudge window in ms = lead + tolerance (NUDGE-SCHED, default 2h + 15m).
 * A meeting whose start is within this of now (and still future) is due for its one nudge.
 * Used by both the frequent MeetingNudgeService and the (idempotent) daily scan path.
 */
export function meetingNudgeWindowMs(config: AppConfig): number {
  return (config.meetingNudgeLeadMinutes + config.meetingNudgeToleranceMinutes) * 60 * 1000;
}

export function scanConfigFrom(config: AppConfig): ScanConfig {
  return {
    coldThresholdDays: config.coldThresholdDays,
    nudgeLeadMs: meetingNudgeWindowMs(config),
    reminderWindowDays: config.reminderWindowDays,
    chatRefreshStaleDays: config.chatRefreshStaleDays,
  };
}

/** Follow-up draft service (grounded on the note's real commitments). */
export function createFollowUpService(config: AppConfig, notes: NoteRepository): FollowUpService {
  return new FollowUpService(createModelClient(config, 'drafts'), notes);
}

/** The pre-meeting brief service (spine + JSONB + semantic search). */
export function createBriefService(
  config: AppConfig,
  clients: ClientRepository,
  notes: NoteRepository,
  facts: FactsRepository,
): BriefService {
  return new BriefService(clients, notes, facts, createEmbedder(config));
}

/** Transactional email: stub locally (records), AWS SES in prod. */
export function createEmailSender(config: AppConfig): EmailSender {
  if (config.emailProvider === 'ses') {
    return new SesEmailSender({ client: new SESv2Client({ region: config.sesRegion }), from: config.emailFrom });
  }
  if (config.emailProvider === 'resend') {
    return new ResendEmailSender({ apiKey: config.resendApiKey ?? '', from: config.emailFrom });
  }
  return new StubEmailSender();
}

/** Idempotency log for lifecycle emails: in-memory locally, Postgres in prod. */
export function createEmailLogRepository(config: AppConfig, pool?: Pool): EmailLogRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgEmailLogRepository(pool);
  }
  return new InMemoryEmailLogRepository();
}

/** The account/lifecycle email service (reset, welcome, trial, billing, delete). */
export function createAccountEmailService(config: AppConfig, pool?: Pool): AccountEmailService {
  return new AccountEmailService(createEmailSender(config), createEmailLogRepository(config, pool));
}

/** Last-run store for the scheduled brain (SWEEP-NEVER-RUNS): Postgres in prod. */
export function createJobRunStore(config: AppConfig, pool?: Pool): JobRunStore {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgJobRunStore(pool);
  }
  return new InMemoryJobRunStore();
}

/** Cross-task job mutex: a Postgres session advisory lock in prod, in-memory locally. */
export function createAdvisoryLock(config: AppConfig, pool?: Pool): AdvisoryLock {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgAdvisoryLock(pool);
  }
  return new InMemoryAdvisoryLock();
}
