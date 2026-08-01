import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { loadMigrations, runMigrations } from './db/migrate.js';
import { createApiServer } from './server.js';
import { BookScanService } from './services/book-scan/book-scan-service.js';
import { TrialExtractionLimiter } from './services/extraction/limiter.js';
import { CorpusStatsService } from './services/corpus/corpus-service.js';
import { MondayDigestService } from './services/monday/monday-service.js';
import {
  createAuthService,
  createClientRepository,
  createNoteRepository,
  createStorage,
  createTranscriptionService,
  createFactsRepository,
  createExtractionService,
  createExtractionModelRouter,
  createRecallService,
  createLedgerService,
  createFollowUpService,
  createExtractionLogRepository,
  createBriefService,
  createCorrectionRepository,
  createMeetingRepository,
  createMeetingParser,
  createNotificationRepository,
  createScanService,
  scanConfigFrom,
  createPushSubscriptionRepository,
  createPushSender,
  createCardScanner,
  createImageRepository,
  createHeroService,
  createBillingService,
  createAccountService,
  createActivationService,
} from './container.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');

async function main(): Promise<void> {
  // Fail fast on bad config BEFORE opening any connection or port.
  const config = loadConfig();

  // Migrations run as the superuser/owner (creates the app role + RLS policies).
  const migrationPool = createPool(config.databaseUrl);
  const client = await migrationPool.connect();
  try {
    const { applied } = await runMigrations(client, loadMigrations(migrationsDir));
    if (applied.length > 0) {
      console.log(`[migrate] applied ${applied.length} migration(s): ${applied.join(', ')}`);
    } else {
      console.log('[migrate] schema up to date');
    }
  } finally {
    client.release();
  }

  // Request-handling queries run through the non-superuser app pool so RLS is
  // enforced (falls back to the superuser URL if APP_DATABASE_URL is unset).
  const appPool = createPool(config.appDatabaseUrl);
  const auth = createAuthService(config, appPool);
  const clients = createClientRepository(config, appPool);
  const notes = createNoteRepository(config, appPool);
  const storage = createStorage(config);
  const transcription = createTranscriptionService(config, notes, storage);
  const facts = createFactsRepository(config, appPool);
  const extractionLogs = createExtractionLogRepository(config, appPool);
  const corrections = createCorrectionRepository(config, appPool);
  // Billing is created early so the extraction router can read trial status (P5-7).
  const billing = createBillingService(config, appPool);
  const modelRouter = createExtractionModelRouter(config, (uid, now) => billing.entitlement(uid, now).then((e) => e.status));
  const extractionLimiter = new TrialExtractionLimiter(
    (uid, now) => billing.entitlement(uid, now).then((e) => e.status),
    (uid) => extractionLogs.listByUser(uid).then((rows) => rows.length),
    config.trialExtractionCeiling,
  );
  const extraction = createExtractionService(config, clients, notes, facts, extractionLogs, corrections, modelRouter, extractionLimiter);
  const followUp = createFollowUpService(config, notes);
  const brief = createBriefService(config, clients, notes, facts);
  const meetings = createMeetingRepository(config, appPool);
  const meetingParser = createMeetingParser(config, clients);
  const notifications = createNotificationRepository(config, appPool);
  const scan = createScanService(clients, meetings, facts, notifications, notes);
  const pushSubscriptions = createPushSubscriptionRepository(config, appPool);
  const pushSender = createPushSender(config);
  const cardScanner = createCardScanner();
  const images = createImageRepository(config, appPool);
  const hero = createHeroService(config, clients, facts, meetings, notes);
  const account = createAccountService(auth, clients, notes, facts, meetings, images);
  const activation = createActivationService(config, appPool);
  const recall = createRecallService(config, notes);
  const corpus = new CorpusStatsService(clients, notes);
  const monday = new MondayDigestService(clients, notes, facts, notifications, config.coldThresholdDays);
  const ledger = createLedgerService(config, appPool);
  const bookScan = new BookScanService(
    { clients, notes, facts },
    { coldThresholdDays: scanConfigFrom(config).coldThresholdDays, upcomingWindowDays: 30 },
  );
  const server = createApiServer({
    pool: appPool,
    auth,
    clients,
    notes,
    storage,
    transcription,
    extraction,
    followUp,
    facts,
    corrections,
    extractionLog: extractionLogs,
    brief,
    meetings,
    meetingParser,
    notifications,
    scan,
    scanConfig: scanConfigFrom(config),
    pushSubscriptions,
    pushSender,
    cardScanner,
    images,
    hero,
    billing,
    account,
    activation,
    bookScan,
    recall,
    corpus,
    monday,
    ledger,
    cookieSecure: config.nodeEnv === 'production',
  });
  server.listen(config.port, () => {
    console.log(`[api] listening on http://0.0.0.0:${config.port} (${config.nodeEnv})`);
  });

  const shutdown = () => {
    server.close(() => {
      void Promise.all([appPool.end(), migrationPool.end()]).then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  // Named, actionable failure — never a silent half-up state.
  console.error(`[api] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
