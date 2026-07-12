import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import type { ModelClient } from './ports/model.js';
import type { AuthProvider } from './ports/auth.js';
import type { Storage } from './ports/storage.js';
import type { Scheduler } from './ports/scheduler.js';
import type { UserRepository } from './ports/user-repository.js';
import type { SessionRepository } from './ports/session-repository.js';
import { StubModelClient } from './adapters/model/stub.js';
import { AnthropicModelClient } from './adapters/model/anthropic.js';
import { StubAuthProvider } from './adapters/auth/stub.js';
import { FsStorage } from './adapters/storage/fs.js';
import { LocalScheduler } from './adapters/scheduler/local.js';
import { InMemoryUserRepository } from './adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from './adapters/auth/in-memory-session-repository.js';
import { PgUserRepository } from './adapters/auth/pg-user-repository.js';
import { PgSessionRepository } from './adapters/auth/pg-session-repository.js';
import { AuthService } from './services/auth/auth-service.js';
import { ScryptHasher } from './services/auth/password.js';
import type { ClientRepository } from './ports/client-repository.js';
import { InMemoryClientRepository } from './adapters/clients/in-memory-client-repository.js';
import { PgClientRepository } from './adapters/clients/pg-client-repository.js';
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
import type { PushSender, PushSubscriptionRepository } from './ports/push.js';
import { StubPushSender } from './adapters/push/stub-sender.js';
import { WebPushSender } from './adapters/push/webpush-sender.js';
import { InMemoryPushSubscriptionRepository } from './adapters/push/in-memory-push-subscription-repository.js';
import { PgPushSubscriptionRepository } from './adapters/push/pg-push-subscription-repository.js';
import type { CardScanner } from './ports/card-scanner.js';
import { StubCardScanner } from './adapters/vision/stub-card-scanner.js';
import type { ImageRepository } from './ports/image-repository.js';
import { InMemoryImageRepository } from './adapters/images/in-memory-image-repository.js';
import { PgImageRepository } from './adapters/images/pg-image-repository.js';
import { HeroService } from './services/hero/hero-service.js';
import { BillingService } from './services/billing/billing-service.js';
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

export function createModelClient(config: AppConfig): ModelClient {
  if (config.modelProvider === 'anthropic') {
    return new AnthropicModelClient({
      apiKey: config.anthropicApiKey ?? '',
      baseUrl: config.anthropicBaseUrl,
      model: config.anthropicModel,
    });
  }
  return new StubModelClient();
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
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    users = new PgUserRepository(pool);
    sessions = new PgSessionRepository(pool);
  } else {
    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository();
  }
  return new AuthService({
    users,
    sessions,
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
    return new GroqTranscriber({
      apiKey: config.groqApiKey ?? '',
      baseUrl: config.groqBaseUrl,
      model: config.groqModel,
    });
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
    return new BedrockEmbedder({ region: config.bedrockRegion, modelId: config.embedModel, dimension: 1024 });
  }
  return new StubEmbedder(1024);
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
): ExtractionService {
  const modelId = config.modelProvider === 'anthropic' ? config.anthropicModel : 'stub';
  return new ExtractionService(createModelClient(config), clients, notes, facts, createEmbedder(config), logs, modelId);
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
): ScanService {
  return new ScanService(clients, meetings, facts, notifications);
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
    return new WebPushSender({ publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey, subject: config.vapidSubject });
  }
  return new StubPushSender();
}

/** Business-card vision scan: stub locally; real vision model at deploy. */
export function createCardScanner(): CardScanner {
  return new StubCardScanner();
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

export function createBillingService(config: AppConfig, pool?: Pool): BillingService {
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
    ? new StripeGatewayImpl({ secretKey: config.stripeSecretKey, webhookSecret: config.stripeWebhookSecret, priceId: config.stripePriceId, successUrl: config.stripeSuccessUrl, cancelUrl: config.stripeCancelUrl })
    : new StubStripeGateway(config.stripeWebhookSecret);
  return new BillingService(subs, trials, events, stripe, config.trialDays);
}

export function createAccountService(auth: AuthService, clients: ClientRepository, notes: NoteRepository, facts: FactsRepository, meetings: MeetingRepository): AccountService {
  // On Postgres, deleting the user cascades all data (FKs) — no explicit purge list.
  return new AccountService(auth, clients, notes, facts, meetings, []);
}

export function createActivationService(config: AppConfig, pool?: Pool): ActivationService {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new ActivationService(new PgActivationRepository(pool), new LogAnalytics());
  }
  return new ActivationService(new InMemoryActivationRepository(), new InMemoryAnalytics());
}

export function scanConfigFrom(config: AppConfig): ScanConfig {
  return {
    coldThresholdDays: config.coldThresholdDays,
    nudgeLeadMs: config.nudgeLeadHours * 60 * 60 * 1000,
    reminderWindowDays: config.reminderWindowDays,
  };
}

/** Follow-up draft service (grounded on the note's real commitments). */
export function createFollowUpService(config: AppConfig, notes: NoteRepository): FollowUpService {
  return new FollowUpService(createModelClient(config), notes);
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
