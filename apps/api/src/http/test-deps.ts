import type { Pool } from 'pg';
import type { ApiDeps } from '../server.js';
import { AuthService } from '../services/auth/auth-service.js';
import { ScryptHasher } from '../services/auth/password.js';
import { InMemoryUserRepository } from '../adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from '../adapters/auth/in-memory-session-repository.js';
import { InMemoryPasswordResetRepository } from '../adapters/auth/in-memory-password-reset-repository.js';
import { InMemoryEmailVerificationRepository } from '../adapters/auth/in-memory-email-verification-repository.js';
import { AccountEmailService } from '../services/email/account-email-service.js';
import { StubEmailSender } from '../adapters/email/stub-email-sender.js';
import { InMemoryEmailLogRepository } from '../adapters/email/in-memory-email-log-repository.js';
import { InMemoryClientRepository } from '../adapters/clients/in-memory-client-repository.js';
import { InMemoryInventoryRepository } from '../adapters/inventory/in-memory-inventory-repository.js';
import { InventoryService } from '../services/inventory/inventory-service.js';
import { InMemoryNoteRepository } from '../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../adapters/storage/in-memory.js';
import { StubTranscriber } from '../adapters/transcription/stub.js';
import { TranscriptionService } from '../services/transcription/transcription-service.js';
import { StubModelClient } from '../adapters/model/stub.js';
import { InMemoryFactsRepository } from '../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../adapters/embedding/stub.js';
import { ExtractionService } from '../services/extraction/extraction-service.js';
import type { ExtractionLimiter } from '../services/extraction/limiter.js';
import { BriefService } from '../services/brief/brief-service.js';
import { FollowUpService } from '../services/followup/follow-up-service.js';
import { InMemoryCorrectionRepository } from '../adapters/corrections/in-memory-correction-repository.js';
import { InMemoryMeetingRepository } from '../adapters/meetings/in-memory-meeting-repository.js';
import { MeetingParser } from '../services/meetings/meeting-parser.js';
import { InMemoryNotificationRepository } from '../adapters/notifications/in-memory-notification-repository.js';
import { ScanService } from '../services/scan/scan-service.js';
import { HeroService } from '../services/hero/hero-service.js';
import { PrioritiesService } from '../services/hero/priorities-service.js';
import { InMemoryPrioritiesRepository } from '../adapters/priorities/in-memory-priorities-repository.js';
import { BookScanService } from '../services/book-scan/book-scan-service.js';
import { RecallService } from '../services/recall/recall-service.js';
import { InMemoryRecallSessionRepository } from '../adapters/recall/in-memory-recall-session-repository.js';
import { CorpusStatsService } from '../services/corpus/corpus-service.js';
import { MondayDigestService } from '../services/monday/monday-service.js';
import { LedgerService } from '../services/ledger/ledger-service.js';
import { InMemoryLedgerRepository } from '../adapters/ledger/in-memory-ledger-repository.js';
import { ReferralService } from '../services/referral/referral-service.js';
import { InMemoryReferralRepository } from '../adapters/referral/in-memory-referral-repository.js';
import { BillingService } from '../services/billing/billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../adapters/billing/stub-stripe.js';
import { AccountService } from '../services/account/account-service.js';
import { ActivationService } from '../services/analytics/activation-service.js';
import { InMemoryActivationRepository, InMemoryAnalytics } from '../adapters/analytics/in-memory.js';
import { InMemoryPushSubscriptionRepository } from '../adapters/push/in-memory-push-subscription-repository.js';
import { InMemoryPushBudgetRepository } from '../adapters/push/in-memory-push-budget-repository.js';
import { StubPushSender } from '../adapters/push/stub-sender.js';
import { PushDispatchService } from '../services/push/push-dispatch-service.js';
import { InMemoryImageRepository } from '../adapters/images/in-memory-image-repository.js';
import { InMemoryJobRunStore } from '../adapters/scheduler/in-memory-scheduled-jobs.js';
import { ModelMetricsRegistry } from '../services/metrics/model-metrics.js';

export interface TestDeps extends ApiDeps {
  storage: InMemoryStorage;
  notes: InMemoryNoteRepository;
  clients: InMemoryClientRepository;
  inventory: InventoryService;
  inventoryRepo: InMemoryInventoryRepository;
}

/**
 * Build a full in-memory ApiDeps for HTTP tests. Central so adding a dependency
 * touches one place, not every test file.
 */
export function buildInMemoryDeps(
  overrides: Partial<ApiDeps> = {},
  opts: { extractionLimiter?: ExtractionLimiter } = {},
): TestDeps {
  const stubPool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const auth = new AuthService({
    users: new InMemoryUserRepository(),
    sessions: new InMemorySessionRepository(),
    passwordResets: new InMemoryPasswordResetRepository(),
    emailVerifications: new InMemoryEmailVerificationRepository(),
    hasher: new ScryptHasher(),
    sessionTtlMs: 60 * 60 * 1000,
  });
  const notes = new InMemoryNoteRepository();
  const storage = new InMemoryStorage();
  const clients = new InMemoryClientRepository();
  const inventoryRepo = new InMemoryInventoryRepository();
  const facts = new InMemoryFactsRepository();
  const transcription = new TranscriptionService(new StubTranscriber('clear transcript'), notes, storage);
  const embedder = new StubEmbedder(8);
  const ledger = new LedgerService(new InMemoryLedgerRepository());
  const inventory = new InventoryService(inventoryRepo, embedder, ledger);
  const extractionLog = new InMemoryExtractionLogRepository();
  const corrections = new InMemoryCorrectionRepository();
  const extraction = new ExtractionService(
    new StubModelClient(),
    clients,
    notes,
    facts,
    embedder,
    extractionLog,
    'stub',
    corrections,
    undefined,
    opts.extractionLimiter,
  );
  const brief = new BriefService(clients, notes, facts, embedder);
  const followUp = new FollowUpService(new StubModelClient(), notes);
  const meetings = new InMemoryMeetingRepository();
  const meetingParser = new MeetingParser(new StubModelClient(), clients);
  const notifications = new InMemoryNotificationRepository();
  const scan = new ScanService(clients, meetings, facts, notifications, notes);
  const pushSubscriptions = new InMemoryPushSubscriptionRepository();
  const pushSender = new StubPushSender();
  const pushDispatch = new PushDispatchService(pushSender, pushSubscriptions, notifications, new InMemoryPushBudgetRepository());
  const images = new InMemoryImageRepository();
  const recallSessions = new InMemoryRecallSessionRepository();
  const hero = new HeroService({ clients, facts, meetings, notes }, { minClients: 5, minNotes: 20 }, 30);
  const billing = new BillingService(new InMemorySubscriptionRepository(), new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 7);
  return {
    pool: stubPool,
    auth,
    clients,
    inventory,
    inventoryRepo,
    notes,
    storage,
    transcription,
    extraction,
    followUp,
    facts,
    corrections,
    extractionLog,
    brief,
    meetings,
    meetingParser,
    notifications,
    scan,
    scanConfig: { coldThresholdDays: 30, nudgeLeadMs: 24 * 60 * 60 * 1000, reminderWindowDays: 7, chatRefreshStaleDays: 21 },
    pushSubscriptions,
    pushSender,
    pushDispatch,
    images,
    hero,
    priorities: new PrioritiesService(hero, new StubModelClient(), new InMemoryPrioritiesRepository()),
    billing,
    account: new AccountService(auth, clients, notes, facts, meetings, images, recallSessions, [clients, notes, facts, meetings, inventoryRepo]),
    activation: new ActivationService(new InMemoryActivationRepository(), new InMemoryAnalytics()),
    bookScan: new BookScanService({ clients, notes, facts }, { coldThresholdDays: 30, upcomingWindowDays: 30 }),
    recall: new RecallService(embedder, notes, new StubModelClient(), { topK: 5, minSimilarity: -1, maxRetrievalTokens: 100000 }, undefined, 'stub', recallSessions),
    corpus: new CorpusStatsService(clients, notes),
    monday: new MondayDigestService(clients, notes, facts, notifications, 30, pushDispatch),
    ledger,
    referral: new ReferralService(new InMemoryReferralRepository(), billing, (code) => auth.findUserIdByReferralCode(code)),
    accountEmail: new AccountEmailService(new StubEmailSender(), new InMemoryEmailLogRepository()),
    appBaseUrl: 'http://localhost:5173',
    jobRuns: new InMemoryJobRunStore(),
    modelMetrics: new ModelMetricsRegistry(),
    ...overrides,
  } as TestDeps;
}
