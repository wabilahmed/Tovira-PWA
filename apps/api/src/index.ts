import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, assertDeployReady, describeAdapters, opsSurfaceWarning, topUpOptionById, TOP_UP_OPTIONS } from './config.js';
import { FixedWindowRateLimiter } from './services/security/rate-limiter.js';
import { AccessRequestService } from './services/access/access-request-service.js';
import { PgAccessRequestRepository } from './adapters/access/pg-access-request-repository.js';
import { PgInviteRepository } from './adapters/access/pg-invite-repository.js';
import { PgAccessApprovalTx } from './adapters/access/pg-access-approval-tx.js';
import { PgInviteActivationTx } from './adapters/access/pg-invite-activation-tx.js';
import { AccessApprovalService } from './services/access/access-approval-service.js';
import { AccessRequestRetentionService, ACCESS_REQUEST_RETENTION_DAYS } from './services/access/access-request-retention.js';
import { AudioRetentionService, AUDIO_RETENTION_DAYS } from './services/media/audio-retention-service.js';
import { BulkImportService } from './services/import/bulk-import-service.js';
import { BulkBatchRetentionService, BULK_BATCH_TTL_MS } from './services/import/bulk-batch-retention.js';
import { BulkUpsellService } from './services/import/bulk-upsell.js';
import { bulkConcurrency } from './services/import/bulk-extraction.js';
import { PgUserRepository } from './adapters/auth/pg-user-repository.js';
import { ScryptHasher } from './services/auth/password.js';
import { createPool } from './db/pool.js';
import { loadMigrations, runMigrations } from './db/migrate.js';
import { createApiServer } from './server.js';
import { BookScanService } from './services/book-scan/book-scan-service.js';
import { TrialExtractionLimiter } from './services/extraction/limiter.js';
import { CorpusStatsService } from './services/corpus/corpus-service.js';
import { PrioritiesService } from './services/hero/priorities-service.js';
import { NoteSweepService, DEFAULT_MAX_SWEEP_ATTEMPTS, EXTRACTION_CLAIM_TIMEOUT_MS } from './services/notes/note-sweep-service.js';
import { createClaimAndExtract } from './services/notes/claim-and-extract.js';
import { ImportCompletionService } from './services/notes/import-completion-service.js';
import { TrialEmailService } from './services/email/trial-email-service.js';
import { MondayDigestService } from './services/monday/monday-service.js';
import { DailyDigestService } from './services/digest/daily-digest-service.js';
import { ErasureService } from './services/erasure/erasure-service.js';
import { ErasureRequestService } from './services/erasure/erasure-request-service.js';
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
  createSpendLedgerRepository,
  createAiAllowanceRepository,
  createAiPauseRepository,
  createEmailSender,
  createOpsAlertRepository,
  createExtractionCounter,
  createModelCallEventStore,
  createSpendOverrideRepository,
  createBriefService,
  createCorrectionRepository,
  createRepGlossaryRepository,
  createClientPointerRepository,
  createMeetingRepository,
  createRequirementRepository,
  createInventoryMatchRepository,
  createMatchingService,
  createNoteMoveAuditRepository,
  createNoteMoveTx,
  createNoteMoveService,
  createContactAliasRepository,
  createImportAckRepository,
  createRepNameRepository,
  createMeetingParser,
  createNotificationRepository,
  createScanService,
  scanConfigFrom,
  meetingNudgeWindowMs,
  createPushSubscriptionRepository,
  createPushSender,
  createPushDispatchService,
  createErasureAuditRepository,
  createErasureRequestRepository,
  createErasureReceiptRepository,
  createAccountEmailService,
  createImageRepository,
  createHeroService,
  createModelClient,
  createPrioritiesRepository,
  createBillingService,
  createBillingDunningService,
  createAccountService,
  createActivationService,
  createJobRunStore,
  createAdvisoryLock,
} from './container.js';
import { ScheduledBrain } from './services/scheduler/scheduled-brain.js';
import { aiPausedForState } from './services/billing/billing-access.js';
import { OutcomeInferenceService } from './services/outcomes/outcome-inference-service.js';
import { TrainingLogStatsService } from './services/facts/training-log-stats.js';
import { PgTrainingLogStatsRepository } from './adapters/logs/pg-training-log-stats-repository.js';
import { MeetingNudgeService } from './services/scheduler/meeting-nudge-service.js';
import { ScanRunnerService } from './services/scheduler/scan-runner-service.js';
import { NudgeSignalsProvider } from './services/scheduler/nudge-signals.js';
import { modelMetrics } from './services/metrics/model-metrics.js';
import { RecallMetrics } from './services/metrics/recall-metrics.js';
import { ImportCostMetrics } from './services/metrics/import-cost-metrics.js';
import { ExtractionHealthRegistry } from './services/metrics/extraction-health.js';
import { ExtractionCanaryService } from './services/extraction/extraction-canary.js';
import { SpendService } from './services/spend/spend-service.js';
import { periodKeyFrom } from './services/spend/period.js';
import { setSpendSink, setModelCallEventSink } from './adapters/model/metered.js';
import { AiGate, setAiGate, PauseFlagCache } from './services/spend/ai-gate.js';
import { AllowanceStatusService } from './services/spend/allowance-status.js';
import { allowanceWindow } from './services/spend/ai-period.js';
import { ModelCallEventService } from './services/spend/model-call-event-service.js';
import { EXTRACTION_SYSTEM_PROMPT, estimateTokens } from './services/extraction/prompt.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');

async function main(): Promise<void> {
  // Fail fast on bad config BEFORE opening any connection or port.
  const config = loadConfig();
  // …and on a half-configured real provider (e.g. EMAIL_SENDER=ses with no
  // sender), with every offending key named at once (DEPLOY-READY).
  assertDeployReady(config);
  // [OPS-VISIBILITY] A missing OPS_TOKEN in prod is fail-closed (safe) but silent — warn loudly so a
  // dark ops surface is noticed at boot, not months later. Public /health also reports opsConfigured.
  const opsWarn = opsSurfaceWarning(config);
  if (opsWarn) console.warn(opsWarn);
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
  // [BETA-5] Beta intake/invite stores (pre-tenant; same app pool). The invite repo is shared with the
  // auth service so an invite-pending account is unreachable by password reset.
  const invites = new PgInviteRepository(appPool);
  const accessRequests = new PgAccessRequestRepository(appPool);
  const inviteActivation = new PgInviteActivationTx(appPool, new PgUserRepository(appPool));
  const auth = createAuthService(config, appPool, invites, inviteActivation);
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
  const repGlossary = createRepGlossaryRepository(config, appPool);
  const clientPointers = createClientPointerRepository(config, appPool); // [POINTERS]
  // Billing is created early so the extraction router can read trial status (P5-7).
  // [BILLING-DUNNING] The failed-payment pay link: the Stripe hosted invoice page (3DS) when we have it,
  // else the billing settings page. Export link for the deletion warnings (D8).
  const payUrlFor = async (userId: string): Promise<string> => {
    const url = (await billing.entitlement(userId, Date.now())).hostedInvoiceUrl;
    return url ?? `${config.appBaseUrl}/settings`;
  };
  const dayStamp = (): string => new Date().toISOString().slice(0, 10);
  const billingEmailHook = {
    paymentFailed: async (userId: string, eventId: string) => { const to = await emailFor(userId); if (to) await accountEmail.sendPaymentFailed(userId, to, eventId, await payUrlFor(userId)); },
    subscriptionConfirmed: async (userId: string, eventId: string, renewsAt: number | null) => { const to = await emailFor(userId); if (to) await accountEmail.sendSubscriptionConfirmed(userId, to, eventId, renewsAt); },
    subscriptionCanceled: async (userId: string, eventId: string) => { const to = await emailFor(userId); if (to) await accountEmail.sendSubscriptionCanceled(userId, to, eventId); },
    dailyReminder: async (userId: string) => { const to = await emailFor(userId); if (to) await accountEmail.sendPaymentReminder(userId, to, dayStamp(), await payUrlFor(userId)); },
    suspended: async (userId: string) => { const to = await emailFor(userId); if (to) await accountEmail.sendSuspended(userId, to, await payUrlFor(userId)); },
    subscriptionEnded: async (userId: string) => { const to = await emailFor(userId); if (to) await accountEmail.sendSubscriptionEnded(userId, to); },
    deletionWarning: async (userId: string, daysLeft: 30 | 7) => { const to = await emailFor(userId); if (to) await accountEmail.sendDeletionWarning(userId, to, daysLeft, `${config.appBaseUrl}/account/export`); },
  };
  const opsAlerts = createOpsAlertRepository(config, migrationPool);
  // [BILLING-DUNNING · ruling 1] Stripe cancelling a subscription BEFORE our day-30 end is an anomaly —
  // alert ops, never silently treat it as ended.
  const billingOpsAlert = (event: string, detail: Record<string, unknown>): Promise<void> =>
    opsAlerts.createIfAbsent({ kind: event, userId: String(detail.userId ?? ''), dedupeKey: `${event}:${String(detail.userId ?? '')}`, detail }).then(() => undefined);
  const billing = createBillingService(config, appPool, billingEmailHook, billingOpsAlert);
  const billingDunning = createBillingDunningService(config, appPool, billingEmailHook);
  // [SPEND-CAP] Durable per-account spend, bucketed by the rep's billing period. The spend sink is
  // set process-wide so every metered model call records against it (no threading through every
  // createModelClient). Enforcement (the sweep/recall gates + the 80% ops alert + override) is wired
  // further down once its stores exist.
  const spendLedger = createSpendLedgerRepository(config, appPool, migrationPool);
  const spendOverrides = createSpendOverrideRepository(config, migrationPool);
  const spendPeriodFor = (uid: string, now: number) => billing.entitlement(uid, now).then((e) => periodKeyFrom({ status: e.status, trialEndsAt: e.trialEndsAt, renewsAt: e.renewsAt, periodStart: e.periodStart }, now).key);
  // CAP-WARN: at 80% of the cap, alert OPS (not the rep — a rep on a generous cap is doing nothing
  // wrong). Idempotent per rep per period via the dedupe key.
  const onSpendWarn = async (e: { userId: string; periodKey: string; spentAed: number; capAed: number; dominantClass: string | null }): Promise<void> => {
    await opsAlerts.createIfAbsent({
      kind: 'spend_warn',
      userId: e.userId,
      dedupeKey: `spendcap80:${e.userId}:${e.periodKey}`,
      detail: { spentAed: Math.round(e.spentAed * 100) / 100, capAed: e.capAed, dominantClass: e.dominantClass, warnFraction: config.spendWarnFraction },
    });
  };
  const spend = new SpendService(spendLedger, spendPeriodFor, { capAed: config.spendCapAed, trialCapAed: config.trialSpendCapAed, warnFraction: config.spendWarnFraction }, () => Date.now(), (u, pk) => spendOverrides.effectiveCap(u, pk), onSpendWarn);
  setSpendSink(spend); // every metered model call now records its AED against the rep's period
  // [SPEND-INSTRUMENT] Per-call event log alongside the ledger: class/model/tokens/cache/cost per call
  // (system calls recorded account-less). Cross-tenant ops accounting → the root pool.
  const modelCallEvents = createModelCallEventStore(config, migrationPool);
  setModelCallEventSink(new ModelCallEventService(modelCallEvents, (uid) => spendPeriodFor(uid, Date.now())));
  // [USAGE-ALLOWANCE] THE GATE. Built here and armed with setAiGate so every gated provider wrapper
  // (model/embedder/transcriber) reserves against the rep's monthly allowance before each call and
  // settles the actual after. The global monthly total feeds a one-shot email alert; it never blocks.
  const aiAllowance = createAiAllowanceRepository(config, appPool, migrationPool);
  // [USAGE-ALLOWANCE · D14] runtime kill switch: DB-backed, read by the gate with a <=30s cache; the
  // AI_PAUSED env still forces pause ON at boot.
  const aiPause = createAiPauseRepository(config, migrationPool);
  const pauseFlag = new PauseFlagCache(aiPause, config.aiPaused);
  const aiAlertSender = createEmailSender(config);
  const aiBillingWindowFor = (uid: string) =>
    billing.entitlement(uid, Date.now()).then((e) => ({ status: e.status, trialEndsAt: e.trialEndsAt, renewsAt: e.renewsAt, periodStart: e.periodStart }));
  const aiGate = new AiGate({
    allowance: aiAllowance,
    allowanceAed: config.monthlyAiAllowanceAed,
    alertThresholdAed: config.aiSpendAlertAed,
    billingWindowFor: aiBillingWindowFor,
    isPaused: () => pauseFlag.paused(),
    onAlert: async (ym, totalAed) => {
      console.error(`[ai-spend-alert] global AI spend for ${ym} crossed AED ${config.aiSpendAlertAed}: now AED ${totalAed.toFixed(2)}`);
      if (config.accessRequestNotifyEmail) {
        await aiAlertSender.send({
          to: config.accessRequestNotifyEmail,
          subject: `Tovira AI spend alert — ${ym} crossed AED ${config.aiSpendAlertAed}`,
          text: `Total AI spend across all accounts for ${ym} is now AED ${totalAed.toFixed(2)}, past the AED ${config.aiSpendAlertAed} alert threshold. This is an alert only — nothing was paused or blocked.`,
        });
      }
    },
  });
  setAiGate(aiGate);
  // [USAGE-ALLOWANCE · D4] The rep-facing status + the pre-call "is AI stopped?" check used by import,
  // questions, and the scheduled AI jobs so they refuse/skip up front instead of calling a model to
  // discover it.
  const allowanceStatus = new AllowanceStatusService({ allowance: aiAllowance, allowanceAed: config.monthlyAiAllowanceAed, billingWindowFor: aiBillingWindowFor });
  const aiExhausted = (uid: string) => allowanceStatus.isExhausted(uid);
  // [USAGE-ALLOWANCE · D12] Credit a confirmed top-up to the rep's current window (idempotent via the
  // webhook_events dedupe). Set here because the allowance repo is built after billing.
  billing.setTopUpHandler(async (eventId, userId, optionId) => {
    const opt = topUpOptionById(optionId);
    if (!opt) { console.warn(`[usage-allowance] unknown top-up option ${optionId} for ${userId}`); return; }
    const w = allowanceWindow(await aiBillingWindowFor(userId), Date.now());
    await aiAllowance.creditTopUpOnce(eventId, userId, w.key, w.startMs, config.monthlyAiAllowanceAed, opt.addedAed);
  });
  // CAP-ENFORCE: recall keeps working at the cap but is limited to N/day WHILE capped (Wabil's ruling).
  const modelRouter = createExtractionModelRouter(config, (uid, now) => billing.entitlement(uid, now).then((e) => e.status));
  // [TRIAL-FARM] Durable, monotonic extraction counter (not prunable log rows) backs the ceilings.
  const extractionCounter = createExtractionCounter(config, appPool);
  const extractionLimiter = new TrialExtractionLimiter(
    (uid, now) => billing.entitlement(uid, now).then((e) => ({
      status: e.status,
      periodKey: periodKeyFrom({ status: e.status, trialEndsAt: e.trialEndsAt, renewsAt: e.renewsAt, periodStart: e.periodStart }, now).key,
    })),
    extractionCounter,
    { trial: config.trialExtractionCeiling, paid: config.paidExtractionCeiling },
  );
  const meetings = createMeetingRepository(config, appPool);
  const requirements = createRequirementRepository(config, appPool);
  const inventoryMatches = createInventoryMatchRepository(config, appPool);
  const matching = createMatchingService(inventoryMatches, requirements, inventoryRepo);
  const noteMoveAudit = createNoteMoveAuditRepository(config, appPool);
  const noteMoveTx = createNoteMoveTx(config, appPool, notes, facts, meetings, clients, noteMoveAudit, requirements, inventoryMatches);
  const noteMove = createNoteMoveService(notes, facts, meetings, noteMoveTx);
  // [ALIAS] learned WhatsApp contact aliases + the rep's own display name (import counterpart id).
  const contactAliases = createContactAliasRepository(config, appPool);
  const repNames = createRepNameRepository(config, appPool);
  const importAck = createImportAckRepository(config, appPool);
  // NUDGE-UNCONFIRMED: extraction persists proposed meetings (confirmed:false) so they can be
  // surfaced and confirmed; the timezone resolves a proposed wall-clock to an absolute instant.
  // COST-IMPORT-METRIC: a rolling per-rep import cost, recorded at extraction time for imports.
  const importCost = new ImportCostMetrics();
  const extractionHealth = new ExtractionHealthRegistry(); // [EXTRACT-STOPREASON] starved-output counter
  // [EXTRACTION-METRICS] extraction-log volume on /health, via the SUPERUSER pool (cross-tenant, RLS
  // would hide it). Cached by the service so the ALB health check never triggers a DB scan. Warmed at startup.
  const trainingLogStats = new TrainingLogStatsService(new PgTrainingLogStatsRepository(migrationPool));
  void trainingLogStats.refresh();
  // [TRIAL-FARM] Extraction — the one paid, unbounded-cost operation — is gated on a verified email.
  const verifiedGate = { isVerified: (uid: string) => auth.getPublicUser(uid).then((u) => u?.emailVerified ?? false) };
  const extraction = createExtractionService(config, clients, notes, facts, extractionLogs, repGlossary, modelRouter, extractionLimiter, meetings, (userId) => auth.timezoneFor(userId), requirements, matching, importCost, aiExhausted, (uid, cid) => contactAliases.listByClient(uid, cid), extractionHealth, verifiedGate, clientPointers);
  // [EXTRACT-CANARY] one real extraction call/day over the SAME Sonnet path, asserting a text block
  // comes back — the pennies/hours tripwire for the decay class that reached a blind test.
  const extractionCanary = new ExtractionCanaryService(createModelClient(config));
  const followUp = createFollowUpService(config, notes);
  const brief = createBriefService(config, clients, notes, facts, clientPointers);
  const meetingParser = createMeetingParser(config, clients);
  const notifications = createNotificationRepository(config, appPool);
  const scan = createScanService(clients, meetings, facts, notifications, notes, (userId) => auth.timezoneFor(userId));
  const pushSubscriptions = createPushSubscriptionRepository(config, appPool);
  const pushSender = createPushSender(config);
  const pushDispatch = createPushDispatchService(pushSender, pushSubscriptions, notifications);
  // [ERASURE] single-counterparty erasure (Terms 4.9), operator-run via the ops route.
  // [ERASURE-SUMMARY] the certified extractor for re-summarising a note after the requester's messages
  // are removed. A metered client, but every rewrite request carries spendClass 'erasure' and NO userId,
  // so it records account-less — never a rep's spend cap or extraction ceiling (erasure is legal, not usage).
  const erasure = new ErasureService({ clients, notes, audit: createErasureAuditRepository(config, appPool), blobStorage: storage, repGlossary, summariser: createModelClient(config, 'extraction'), clientPointers });
  // [ERASURE-RECEIPT] the proof-of-erasure store uses the ROOT pool (migrationPool): it has no RLS and
  // no user_id/FK, so it is not tenant data and it survives the rep deleting their account.
  const erasureRequests = new ErasureRequestService({ erasure, requests: createErasureRequestRepository(config, appPool), receipts: createErasureReceiptRepository(config, migrationPool), notifications, dispatch: (userId, alerts) => pushDispatch.dispatch(userId, alerts) });
  const images = createImageRepository(config, appPool);
  const hero = createHeroService(config, clients, facts, meetings, notes, matching);
  // Daily priorities: precomputed nightly, cached; app-opens serve the cache
  // (cost-guard #3, P4b-3). Uses the priorities-class model (see routing).
  const prioritiesRepo = createPrioritiesRepository(config, appPool);
  const priorities = new PrioritiesService(hero, createModelClient(config, 'priorities'), prioritiesRepo, { timezoneFor: (userId) => auth.timezoneFor(userId) });
  // NOTIF-REWORK: the daily digest reads the SAME precomputed priorities cache (never recomputes).
  const dailyDigest = new DailyDigestService({ priorities: prioritiesRepo, notifications, dispatch: (userId, alerts) => pushDispatch.dispatch(userId, alerts), timezoneFor: (userId) => auth.timezoneFor(userId) });
  // Note sweep (FLOWS-7): advance any rep's stuck pending notes so a voice note or a
  // deferred import (IMPORT-ASYNC) never stalls; bounded retries → terminal
  // needs_review, never lost.
  // [IMPORT-DONE] notify the waiting rep when a deferred import finishes (success or failure).
  const importCompletion = new ImportCompletionService({
    notes,
    clients,
    dispatch: (userId, alerts, nowMs) => pushDispatch.dispatch(userId, alerts, nowMs),
  });
  // [RULING 2 items 2/5/6] The single claim-then-extract path shared by the sweep and the bulk
  // orchestrator. It is the ONE call site that passes forceAllowance (inside createClaimAndExtract).
  const claimAndExtract = createClaimAndExtract({
    claim: (u, id, now) => notes.claimForExtraction(u, id, now),
    extract: (u, id, today, opts) => extraction.extractNote(u, id, today, opts),
  });
  const noteSweep = new NoteSweepService({
    allUserIds: () => auth.allUserIds(),
    listPending: (u) => notes.listPendingByUser(u).then((rows) => rows.map((n) => ({ id: n.id, status: n.status, sweepAttempts: n.sweepAttempts }))),
    transcribe: (u, id) => transcription.transcribeNote(u, id).then(() => undefined),
    extract: (u, id, today) => claimAndExtract(u, id, today).then(() => undefined),
    reclaim: (u) => notes.reclaimStaleExtracting(u, Date.now(), EXTRACTION_CLAIM_TIMEOUT_MS).then(() => undefined),
    setAttempts: (u, id, n) => notes.update(u, id, { sweepAttempts: n }),
    markNeedsReview: (u, id) => notes.update(u, id, { status: 'needs_review' }),
    // [USAGE-ALLOWANCE · D4 / BILLING-DUNNING · D3] A queued note waits while AI is paused — an exhausted
    // allowance OR a failed-payment state (payment_failed/suspended/ended). On a successful payment the
    // billing state returns to active and the sweep processes the waiting notes on its next pass (guard 3).
    canSpend: async (u) => !(await aiExhausted(u)) && !aiPausedForState((await billing.entitlement(u, Date.now())).billingState),
    isVerified: (u) => verifiedGate.isVerified(u), // TRIAL-FARM: an unverified rep's queue waits too
    allow: (u) => extractionLimiter.allow(u), // ASYNC-EXTRACT: a rep at the extraction ceiling waits (no needs_review)
    onSettled: (u, id) => importCompletion.onNoteSettled(u, id), // IMPORT-DONE
  }, DEFAULT_MAX_SWEEP_ATTEMPTS, config.sweepConcurrency);
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
  // [SCAN-WIRING] iterate reps, run all scan generators, dispatch through the silence budget.
  const scanRunner = new ScanRunnerService({
    allUserIds: () => auth.allUserIds(),
    runAll: (userId, nowMs) => scan.runAll(userId, nowMs, scanConfigFrom(config)),
    dispatch: (userId, alerts, nowMs) => pushDispatch.dispatch(userId, alerts, nowMs).then(() => undefined),
  });
  // [NO-TRAINING-RETENTION, 2026-10-02] The training archive was deleted: extraction_logs + corrections
  // are operational metadata only (no conversation content), so there is no corpus to archive.
  // [OUTCOME-2] The nightly deterministic silence rule: mark long-silent open clients lost_inferred,
  // revert when activity resumes. No model call. Rep-set outcomes are never touched.
  const outcomeInference = new OutcomeInferenceService({
    clients,
    allUserIds: () => auth.allUserIds(),
    thresholdDays: config.lostInferredThresholdDays,
  });
  // [AUDIO-RETENTION] Delete voice recordings AUDIO_RETENTION_DAYS after transcription succeeds. Uses
  // the main blob store + the per-rep expirable-audio query; runs on the brain below, not a 2nd scheduler.
  const audioRetention = new AudioRetentionService({ allUserIds: () => auth.allUserIds(), notes, storage });
  const bulkBatchRetention = new BulkBatchRetentionService(storage);
  const jobRunStore = createJobRunStore(config, appPool);
  const scheduledBrain = new ScheduledBrain({
    store: jobRunStore,
    lock: createAdvisoryLock(config, appPool),
    log: (m, e) => console.warn(m, e ?? ''),
    jobs: [
      // Frequent + cheap-when-idle: deferred imports must extract within ~a minute.
      { name: 'notes-sweep', lockKey: 4711001, intervalMs: 15_000,
        run: async () => { await noteSweep.sweep(new Date().toISOString().slice(0, 10)); } },
      // [TZ-SCHED] Priorities precompute runs HOURLY, not once/24h: with the cache keyed on the
      // rep's LOCAL day, each rep is warmed on the first tick after THEIR midnight (idempotent —
      // precompute skips if their local-day row exists), so the list is fresh for their morning
      // regardless of timezone. The (userId, localDay) row is the per-rep-day idempotency record.
      { name: 'priorities-nightly', lockKey: 4711002, intervalMs: 60 * 60 * 1000,
        run: async () => { await priorities.precomputeAll(await auth.allUserIds(), Date.now()); } },
      { name: 'trial-emails', lockKey: 4711003, intervalMs: 24 * 60 * 60 * 1000,
        run: async () => { await trialEmail.run(Date.now()); } },
      // Pre-meeting nudges: every minute so a meeting is caught inside its 2h ± 15m window.
      { name: 'meeting-nudges', lockKey: 4711004, intervalMs: 60_000,
        run: async () => { await meetingNudge.run(Date.now()); } },
      // [TZ-SCHED] Monday digest: HOURLY; fires each rep's digest on THEIR local Monday morning,
      // idempotent per rep-local-week via the monday:<weekOf> dedupe.
      { name: 'monday-digest', lockKey: 4711005, intervalMs: 60 * 60 * 1000,
        run: async () => { await monday.runScheduled(await auth.allUserIds(), Date.now()); } },
      // NOTIF-REWORK: the daily digest — one discretionary push per rep-day at their local hour.
      // lockKey 4711010: UNIQUE per job (advisory lock). 4711006 is daily-scan, …007 extraction-canary,
      // …008 training-archive, …009 outcomes-inference — so the next free key is …010.
      { name: 'daily-digest', lockKey: 4711010, intervalMs: 60 * 60 * 1000,
        run: async () => { await dailyDigest.runScheduled(await auth.allUserIds(), Date.now()); } },
      // [BILLING-DUNNING · D4–D7] Daily: retry the open invoice (app-driven, Stripe built-in can't do
      // daily-for-30), remind, suspend at day 7, end at day 30. Idempotent to once/UTC-day per account.
      // RETIRED advisory lock keys — never reuse (a reused key would silently share a lock with the job
      // that once held it): 4711008 (training-archive, removed). Next fresh key: 4711016.
      { name: 'billing-dunning', lockKey: 4711015, intervalMs: 24 * 60 * 60 * 1000,
        run: async () => { const r = await billingDunning.run(); if (r.scanned > 0) console.log(`[billing-dunning] scanned=${r.scanned} retried=${r.retried} auth3ds=${r.authRequired} suspended=${r.suspended} ended=${r.ended}`); } },
      // [SCAN-WIRING] The daily proactive scan (overdue promises / going cold / date reminders /
      // chat-refresh) — the automated trigger the stub EventBridge Lambda never provided. Every few
      // hours; generators are idempotent (deduped) and the 2/day silence budget bounds pushes.
      { name: 'daily-scan', lockKey: 4711006, intervalMs: 3 * 60 * 60 * 1000,
        run: async () => { await scanRunner.run(Date.now()); } },
      // [EXTRACT-CANARY] Every 6h: one real extraction call asserting a text block returns. A throw
      // records ok:false + the failure reason on /health (jobs[]) within HOURS of any provider drift
      // — the signal that was missing when claude-sonnet-5 started starving the budget. 4 calls/day
      // (~AED 6/mo) is trivial against a silently-broken engine. Combined with boot-retry, a deployed
      // fix re-verifies on the next restart. Logs the reasoning headroom so decay shows BEFORE it breaks.
      { name: 'extraction-canary', lockKey: 4711007, intervalMs: 6 * 60 * 60 * 1000,
        run: async () => { const r = await extractionCanary.run(); console.log(`[canary] extraction ok stop=${r.stopReason} thinking=${r.thinkingTokens} headroom=${r.headroomTokens}`); } },
      // [NO-TRAINING-RETENTION, 2026-10-02] the training-archive job (lockKey 4711008) was removed with
      // the archive subsystem — extraction_logs/corrections are metadata only, nothing to archive.
      // [OUTCOME-2] Daily: mark long-silent open clients lost_inferred and revert those whose activity
      // resumed. Deterministic, no model call. Idempotent, so a restart or extra tick is harmless.
      { name: 'outcomes-inference', lockKey: 4711009, intervalMs: 24 * 60 * 60 * 1000,
        run: async () => { const r = await outcomeInference.recompute(Date.now()); console.log(`[outcomes] inferred=${r.inferred} reverted=${r.reverted}`); } },
      // [BETA-8] Daily: delete stale access requests (rejected + never-acted-on pending) past the
      // retention window. Approved/invited/activated are never touched (authority record). Idempotent.
      { name: 'access-request-retention', lockKey: 4711011, intervalMs: 24 * 60 * 60 * 1000,
        run: async () => { const n = await accessRequestRetention.sweep(Date.now()); console.log(`[retention] access-requests deleted ${n} stale (rejected/abandoned) past ${ACCESS_REQUEST_RETENTION_DAYS}d`); } },
      // [AUDIO-RETENTION] Daily: delete voice recordings past AUDIO_RETENTION_DAYS after transcription
      // succeeded (notes.transcribed_at); the note keeps its transcript and is marked audio-expired.
      // transcription_failed + never-transcribed notes are excluded (recording kept). lockKey 4711012:
      // UNIQUE, the next free key after access-request-retention (…011). Idempotent.
      { name: 'audio-retention', lockKey: 4711012, intervalMs: 24 * 60 * 60 * 1000,
        run: async () => { const n = await audioRetention.sweep(Date.now()); console.log(`[retention] audio deleted ${n} recording(s) past ${AUDIO_RETENTION_DAYS}d after transcription`); } },
      // [USAGE-ALLOWANCE] Free the reservations of calls that crashed mid-flight (expiry past
      // AI_RESERVATION_TTL_MS), so a lost reservation can never permanently eat a rep's headroom.
      // lockKey 4711013: UNIQUE, the next free key. Cross-tenant sweep (superuser pool). Idempotent.
      { name: 'ai-reservation-sweep', lockKey: 4711013, intervalMs: 60_000,
        run: async () => { const n = await aiAllowance.expireStale(Date.now()); if (n > 0) console.log(`[usage-allowance] expired ${n} stale AI reservation(s)`); } },
      // [BULK-IMPORT · FIX 2c] Drop staged chat-upload batches older than the TTL (crash/abandoned-tab
      // leftovers). lockKey 4711014: UNIQUE, next free. Scans the blob store; idempotent.
      { name: 'bulk-batch-retention', lockKey: 4711014, intervalMs: 60 * 60 * 1000,
        run: async () => { const n = await bulkBatchRetention.sweep(Date.now()); if (n > 0) console.log(`[retention] bulk-import deleted ${n} staged batch(es) past ${BULK_BATCH_TTL_MS / 3_600_000}h`); } },
    ],
  }, 15_000); // [ASYNC-EXTRACT] tick every 15s (was 30s) so the notes-sweep (15s interval) fires on
  // time — first-finding latency ~15s rather than up to 30s, for the day-one wow moment. Other jobs
  // have long intervals, so a faster due-check is negligible overhead.
  const recallSessions = createRecallSessionRepository(config, appPool);
  const account = createAccountService(auth, clients, notes, facts, meetings, images, recallSessions, (userId, email) => accountEmail.sendAccountDeleted(userId, email).then(() => undefined), contactAliases, repNames, extractionLogs, corrections, repGlossary, storage, clientPointers);
  const activation = createActivationService(config, appPool);
  const recallMetrics = new RecallMetrics();
  // [ASK-CAPTURE] capture uses the CERTIFIED extraction engine (`extraction`), never the recall model.
  const askCapture = createAskCaptureService(config, notes, clients, facts, extraction, corrections, extractionLogs);
  const recall = createRecallService(config, notes, recallMetrics, recallSessions, askCapture, clients, aiExhausted);
  const corpus = new CorpusStatsService(clients, notes);
  const monday = new MondayDigestService(clients, notes, facts, notifications, config.coldThresholdDays, pushDispatch, (userId) => auth.timezoneFor(userId), matching);
  const ledger = createLedgerService(config, appPool);
  const inventory = createInventoryService(inventoryRepo, ledger, config, matching);
  const referral = new ReferralService(
    config.authStore === 'postgres' ? new PgReferralRepository(appPool) : new InMemoryReferralRepository(),
    billing,
    (code) => auth.findUserIdByReferralCode(code),
  );
  const bookScan = new BookScanService(
    { clients, notes, facts },
    { coldThresholdDays: scanConfigFrom(config).coldThresholdDays, upcomingWindowDays: 30, promiseStaleThresholdDays: config.promiseStaleThresholdDays },
  );
  // [BULK-IMPORT · Task 4] Multi-file import: local parse + review + parallel per-chat extraction. Runs
  // one lane below the background sweep so a big import never starves the live capture path.
  const bulkImport = new BulkImportService({
    clients,
    notes,
    extract: (u, id, today) => claimAndExtract(u, id, today),
    isExhausted: aiExhausted,
    isPaused: () => pauseFlag.paused(),
    concurrency: bulkConcurrency(config.sweepConcurrency),
    allowanceAed: config.monthlyAiAllowanceAed,
    modelId: config.modelProvider === 'anthropic' ? config.anthropicModel : 'stub',
    repNames,
  });
  const bulkUpsell = new BulkUpsellService({
    topUpOptions: TOP_UP_OPTIONS,
    remainingAllowanceAed: async (uid) => {
      const s = await allowanceStatus.status(uid);
      return Math.max(0, s.availableAed - s.spentAed - s.reservedAed);
    },
    canTopUp: async (uid) => (await billing.entitlement(uid, Date.now())).status === 'active',
  });
  // [BETA-5] Approval/invite provisioning. applyReferral reuses the existing ReferralService (declared
  // above), so a persisted landing-page referral is credited at approval through the same code path as
  // a signup — never a second one, and never blocking the approval.
  const accessApproval = new AccessApprovalService({
    requests: accessRequests,
    tx: new PgAccessApprovalTx(appPool, new PgUserRepository(appPool)),
    hasher: new ScryptHasher(),
    sendInvite: (to, inviteUrl) => accountEmail.sendInvite(to, inviteUrl),
    applyReferral: (code, userId, email) => referral.apply(code, userId, email),
    appBaseUrl: config.appBaseUrl,
  });
  const accessRequestRetention = new AccessRequestRetentionService(accessRequests);
  const server = createApiServer({
    pool: appPool,
    auth,
    clients,
    inventory,
    matching,
    notes,
    storage,
    transcription,
    extraction,
    followUp,
    facts,
    noteMove,
    aliases: contactAliases,
    repNames,
    importAck,
    allowanceExhausted: aiExhausted,
    allowanceStatus,
    corrections,
    repGlossary,
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
    clientPointers,
    bulkImport,
    bulkUpsell,
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
    importCost,
    extractionHealth,
    trainingLog: trainingLogStats,
    spend,
    opsAlerts,
    opsRoute: { opsToken: config.opsToken, overrides: spendOverrides, spend, allUserIds: () => auth.allUserIds(), erasure, erasureRequests, modelCallEvents, accessApproval, aiPause },
    cookieSecure: config.nodeEnv === 'production',
    // Brute-force guard: 8 failed logins per IP+email per 15 minutes, then 429.
    loginLimiter: new FixedWindowRateLimiter(8, 15 * 60 * 1000),
    signupEnabled: config.signupEnabled, // [BETA-7] default false — self-registration is invite-only

    // [BETA-3] Public access-request intake. Limiter: 5 submissions per IP per hour. Derivation: a
    // genuine applicant submits once; 5/hour tolerates a shared-office NAT or a retry while bounding a
    // scripted flood. NOTE: this limiter is in-memory and PER-TASK, so across N running API tasks the
    // effective limit is N×5/hour — accepted for a beta access form (not a security control).
    accessRequest: new AccessRequestService(accessRequests),
    accessRequestLimiter: new FixedWindowRateLimiter(5, 60 * 60 * 1000),
    accessRequestNotify: config.accessRequestNotifyEmail
      ? (rec) => accountEmail.sendAccessRequestNotification(config.accessRequestNotifyEmail!, rec, `${config.appBaseUrl}/ops/access-requests/${rec.id}/approve`)
      : undefined,
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
