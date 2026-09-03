import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, assertDeployReady, describeAdapters } from './config.js';
import { FixedWindowRateLimiter } from './services/security/rate-limiter.js';
import { createPool } from './db/pool.js';
import { loadMigrations, runMigrations } from './db/migrate.js';
import { createApiServer } from './server.js';
import { BookScanService } from './services/book-scan/book-scan-service.js';
import { TrialExtractionLimiter } from './services/extraction/limiter.js';
import { CorpusStatsService } from './services/corpus/corpus-service.js';
import { PrioritiesService } from './services/hero/priorities-service.js';
import { NoteSweepService } from './services/notes/note-sweep-service.js';
import { TrialEmailService } from './services/email/trial-email-service.js';
import { MondayDigestService } from './services/monday/monday-service.js';
import { ReferralService } from './services/referral/referral-service.js';
import { InMemoryReferralRepository } from './adapters/referral/in-memory-referral-repository.js';
import { PgReferralRepository } from './adapters/referral/pg-referral-repository.js';
import {
  createAuthService,
  createClientRepository,
  createInventoryRepository,
  createInventoryService,
  createNoteRepository,
  createStorage,
  createTranscriptionService,
  createFactsRepository,
  createExtractionService,
  createExtractionModelRouter,
  createRecallService,
  createRecallSessionRepository,
  createAskCaptureService,
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
  meetingNudgeWindowMs,
  createPushSubscriptionRepository,
  createPushSender,
  createPushBudgetRepository,
  createPushDispatchService,
  createAccountEmailService,
  createImageRepository,
  createHeroService,
  createModelClient,
  createPrioritiesRepository,
  createBillingService,
  createAccountService,
  createActivationService,
  createJobRunStore,
  createAdvisoryLock,
} from './container.js';
import { ScheduledBrain } from './services/scheduler/scheduled-brain.js';
import { MeetingNudgeService } from './services/scheduler/meeting-nudge-service.js';
import { NudgeSignalsProvider } from './services/scheduler/nudge-signals.js';
import { modelMetrics } from './services/metrics/model-metrics.js';
import { RecallMetrics } from './services/metrics/recall-metrics.js';
import { EXTRACTION_SYSTEM_PROMPT, estimateTokens } from './services/extraction/prompt.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');

async function main(): Promise<void> {
  // Fail fast on bad config BEFORE opening any connection or port.
  const config = loadConfig();
  // …and on a half-configured real provider (e.g. EMAIL_SENDER=ses with no
  // sender), with every offending key named at once (DEPLOY-READY).
  assertDeployReady(config);
  // Startup signal: which adapters are live vs stub, so "staging is representative"
  // is verifiable at a glance (and again on GET /health).
  console.log(`[adapters] ${Object.entries(describeAdapters(config)).map(([k, v]) => `${k}=${v}`).join(' ')}`);

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
    // The migration creates the tovira_app role with a dev password; sync it to
    // whatever APP_DATABASE_URL actually uses (prod generates a random one) so
    // the app can authenticate as its RLS-enforced role. Superuser connection.
    if (config.appDatabaseUrl !== config.databaseUrl) {
      const appPw = new URL(config.appDatabaseUrl).password;
      if (appPw) {
        await client.query(`ALTER ROLE tovira_app WITH LOGIN PASSWORD '${appPw.replace(/'/g, "''")}'`);
        console.log('[migrate] synced tovira_app role password');
      }
    }
  } finally {
    client.release();
  }

  // Request-handling queries run through the non-superuser app pool so RLS is
  // enforced (falls back to the superuser URL if APP_DATABASE_URL is unset).
  const appPool = createPool(config.appDatabaseUrl);
  const auth = createAuthService(config, appPool);
  const accountEmail = createAccountEmailService(config, appPool);
  const emailFor = (userId: string): Promise<string | null> => auth.getPublicUser(userId).then((u) => u?.email ?? null);
  const clients = createClientRepository(config, appPool);
  const inventoryRepo = createInventoryRepository(config, appPool);
  const notes = createNoteRepository(config, appPool);
  const storage = createStorage(config);
  const transcription = createTranscriptionService(config, notes, storage);
  const facts = createFactsRepository(config, appPool);
  const extractionLogs = createExtractionLogRepository(config, appPool);
  const corrections = createCorrectionRepository(config, appPool);
  // Billing is created early so the extraction router can read trial status (P5-7).
  const billingEmailHook = {
    paymentFailed: async (userId: string, eventId: string) => { const to = await emailFor(userId); if (to) await accountEmail.sendPaymentFailed(userId, to, eventId); },
    subscriptionConfirmed: async (userId: string, eventId: string, renewsAt: number | null) => { const to = await emailFor(userId); if (to) await accountEmail.sendSubscriptionConfirmed(userId, to, eventId, renewsAt); },
    subscriptionCanceled: async (userId: string, eventId: string) => { const to = await emailFor(userId); if (to) await accountEmail.sendSubscriptionCanceled(userId, to, eventId); },
  };
  const billing = createBillingService(config, appPool, billingEmailHook);
  const modelRouter = createExtractionModelRouter(config, (uid, now) => billing.entitlement(uid, now).then((e) => e.status));
  const extractionLimiter = new TrialExtractionLimiter(
    (uid, now) => billing.entitlement(uid, now).then((e) => e.status),
    (uid) => extractionLogs.listByUser(uid).then((rows) => rows.length),
    config.trialExtractionCeiling,
  );
  const meetings = createMeetingRepository(config, appPool);
  // NUDGE-UNCONFIRMED: extraction persists proposed meetings (confirmed:false) so they can be
  // surfaced and confirmed; the timezone resolves a proposed wall-clock to an absolute instant.
  const extraction = createExtractionService(config, clients, notes, facts, extractionLogs, corrections, modelRouter, extractionLimiter, meetings, (userId) => auth.timezoneFor(userId));
  const followUp = createFollowUpService(config, notes);
  const brief = createBriefService(config, clients, notes, facts);
  const meetingParser = createMeetingParser(config, clients);
  const notifications = createNotificationRepository(config, appPool);
  const scan = createScanService(clients, meetings, facts, notifications, notes);
  const pushSubscriptions = createPushSubscriptionRepository(config, appPool);
  const pushSender = createPushSender(config);
  const pushDispatch = createPushDispatchService(pushSender, pushSubscriptions, notifications, createPushBudgetRepository(config, appPool));
  const images = createImageRepository(config, appPool);
  const hero = createHeroService(config, clients, facts, meetings, notes);
  // Daily priorities: precomputed nightly, cached; app-opens serve the cache
  // (cost-guard #3, P4b-3). Uses the priorities-class model (see routing).
  const priorities = new PrioritiesService(hero, createModelClient(config, 'priorities'), createPrioritiesRepository(config, appPool));
  // Note sweep (FLOWS-7): advance any rep's stuck pending notes so a voice note or a
  // deferred import (IMPORT-ASYNC) never stalls; bounded retries → terminal
  // needs_review, never lost.
  const noteSweep = new NoteSweepService({
    allUserIds: () => auth.allUserIds(),
    listPending: (u) => notes.listPendingByUser(u).then((rows) => rows.map((n) => ({ id: n.id, status: n.status, sweepAttempts: n.sweepAttempts }))),
    transcribe: (u, id) => transcription.transcribeNote(u, id).then(() => undefined),
    extract: (u, id, today) => extraction.extractNote(u, id, today).then(() => undefined),
    setAttempts: (u, id, n) => notes.update(u, id, { sweepAttempts: n }),
    markNeedsReview: (u, id) => notes.update(u, id, { status: 'needs_review' }),
  });
  // Trial-ending (2 days out) + trial-ended emails (EMAIL-HOOKS 1a), idempotent.
  const trialEmail = new TrialEmailService({ listTrialing: () => billing.listTrialing() }, emailFor, accountEmail);

  // SWEEP-NEVER-RUNS: the EventBridge→Lambda path is a stub and a LocalScheduler only
  // fires when triggered — nothing triggered it, so the sweep, nightly priorities and
  // trial emails silently never ran in prod (imported notes were stranded pending).
  // This persistent task drives them on an in-process timer, coordinated across tasks
  // by a Postgres SESSION advisory lock (auto-released on crash), with each run
  // recorded so /health can show the brain is alive.
  // NUDGE-SCHED: the pre-meeting nudge runs here (every ~minute), NOT on the daily scan —
  // a daily job cannot produce a 2-hour-ahead nudge. Same advisory-lock seam as the sweep;
  // idempotent per meeting (nudged_at on the row), delivered through the silence budget.
  const nudgeSignals = new NudgeSignalsProvider({
    clients,
    facts,
    notes,
    timezoneFor: (userId) => auth.timezoneFor(userId),
    coldThresholdDays: config.coldThresholdDays,
  });
  const meetingNudge = new MeetingNudgeService({
    allUserIds: () => auth.allUserIds(),
    generate: (userId, nowMs, windowMs, sink, compose) => scan.nudges(userId, nowMs, windowMs, sink, compose),
    signalsFor: (userId, meeting, nowMs) => nudgeSignals.signalsFor(userId, meeting, nowMs),
    dispatch: (userId, alerts, nowMs) => pushDispatch.dispatch(userId, alerts, nowMs).then(() => undefined),
    windowMs: meetingNudgeWindowMs(config),
  });
  const jobRunStore = createJobRunStore(config, appPool);
  const scheduledBrain = new ScheduledBrain({
    store: jobRunStore,
    lock: createAdvisoryLock(config, appPool),
    log: (m, e) => console.warn(m, e ?? ''),
    jobs: [
      // Frequent + cheap-when-idle: deferred imports must extract within ~a minute.
      { name: 'notes-sweep', lockKey: 4711001, intervalMs: 15_000,
        run: async () => { await noteSweep.sweep(new Date().toISOString().slice(0, 10)); } },
      { name: 'priorities-nightly', lockKey: 4711002, intervalMs: 24 * 60 * 60 * 1000,
        run: async () => { await priorities.precomputeAll(await auth.allUserIds(), Date.now()); } },
      { name: 'trial-emails', lockKey: 4711003, intervalMs: 24 * 60 * 60 * 1000,
        run: async () => { await trialEmail.run(Date.now()); } },
      // Pre-meeting nudges: every minute so a meeting is caught inside its 2h ± 15m window.
      { name: 'meeting-nudges', lockKey: 4711004, intervalMs: 60_000,
        run: async () => { await meetingNudge.run(Date.now()); } },
    ],
  });
  const recallSessions = createRecallSessionRepository(config, appPool);
  const account = createAccountService(auth, clients, notes, facts, meetings, images, recallSessions, (userId, email) => accountEmail.sendAccountDeleted(userId, email).then(() => undefined));
  const activation = createActivationService(config, appPool);
  const recallMetrics = new RecallMetrics();
  // [ASK-CAPTURE] capture uses the CERTIFIED extraction engine (`extraction`), never the recall model.
  const askCapture = createAskCaptureService(config, notes, clients, facts, extraction);
  const recall = createRecallService(config, notes, recallMetrics, recallSessions, askCapture, clients);
  const corpus = new CorpusStatsService(clients, notes);
  const monday = new MondayDigestService(clients, notes, facts, notifications, config.coldThresholdDays, pushDispatch);
  const ledger = createLedgerService(config, appPool);
  const inventory = createInventoryService(inventoryRepo, ledger, config);
  const referral = new ReferralService(
    config.authStore === 'postgres' ? new PgReferralRepository(appPool) : new InMemoryReferralRepository(),
    billing,
    (code) => auth.findUserIdByReferralCode(code),
  );
  const bookScan = new BookScanService(
    { clients, notes, facts },
    { coldThresholdDays: scanConfigFrom(config).coldThresholdDays, upcomingWindowDays: 30 },
  );
  const server = createApiServer({
    pool: appPool,
    auth,
    clients,
    inventory,
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
    pushDispatch,
    images,
    hero,
    priorities,
    billing,
    account,
    activation,
    bookScan,
    recall,
    askCapture,
    corpus,
    monday,
    ledger,
    referral,
    accountEmail,
    appBaseUrl: config.appBaseUrl,
    adapterModes: describeAdapters(config),
    jobRuns: jobRunStore,
    modelMetrics,
    recallMetrics,
    cookieSecure: config.nodeEnv === 'production',
    // Brute-force guard: 8 failed logins per IP+email per 15 minutes, then 429.
    loginLimiter: new FixedWindowRateLimiter(8, 15 * 60 * 1000),
  });
  server.listen(config.port, () => {
    console.log(`[api] listening on http://0.0.0.0:${config.port} (${config.nodeEnv})`);
    // CACHE-1: name, per task class, the model + prefix size + whether a cache
    // breakpoint is set — so a broken/absent cache is visible at boot, not inferred.
    const prefixTok = estimateTokens(EXTRACTION_SYSTEM_PROMPT);
    console.log(`[cache] extraction: model=${config.models.extraction} prefix≈${prefixTok}tok breakpoint=on ttl=${config.extractionCacheTtl} (Sonnet min ~1024)`);
    console.log(`[cache] recall/priorities/brief/followup: model=${config.models.recall} breakpoint=off (system prompts below the cacheable minimum — uncacheable by design)`);
    // Start the scheduled brain once the server is up (migrations have already run,
    // so scheduled_job_runs exists). start() runs one pass immediately.
    scheduledBrain.start();
  });

  const shutdown = () => {
    scheduledBrain.stop();
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
