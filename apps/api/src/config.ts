/**
 * Application configuration, loaded and validated once at boot.
 *
 * Principle (P0-1): a missing/invalid required var must fail FAST with a named,
 * actionable error — never a silent crash or a half-up service.
 */

import { EFFORTS, type Effort, type ThinkingMode } from './adapters/model/capabilities.js';
import type { CacheTtl } from './ports/model.js';
import { CONTACT_EMAIL } from './services/email/contact.js';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export type ModelProvider = 'stub' | 'anthropic';
export type AuthStore = 'memory' | 'postgres';
export type TranscriberProvider = 'stub' | 'groq';
export type EmbedderProvider = 'stub' | 'bedrock';
export type PushProvider = 'stub' | 'webpush';
export type EmailProvider = 'stub' | 'ses' | 'resend';

/**
 * [USAGE-ALLOWANCE · D1] The product default monthly AI-cost allowance (100%), AED. SINGLE SOURCE of the
 * number: the config default below and the top-up amounts are both derived from it, so a change here moves
 * both together and they can never drift apart.
 */
export const DEFAULT_MONTHLY_AI_ALLOWANCE_AED = 60;

/**
 * [USAGE-ALLOWANCE · D6 → P37] One-time top-up products. The rule (owner, 20 Oct): "AED 1 buys 1% of your monthly
 * allowance". Each pack is {priceAed, percent}; the allowance it adds is percent × the monthly allowance AT THE
 * TIME OF PURCHASE (topUpCreditAed), so the rule holds if the allowance changes. Top-ups never expire and are
 * spent only after the monthly allowance (D7); buying one drops the meter (D8). Subscribers only (D10).
 */
export interface TopUpOption {
  id: string;
  /** Allowance (AI cost, AED) this top-up adds at the DEFAULT allowance — for server-side shortfall maths only. */
  addedAed: number;
  /** What the rep pays, AED. */
  priceAed: number;
  /** Share of the monthly allowance, for the label (e.g. '+50%'). */
  label: string;
}
/** [P37] The packs on sale. */
export const TOP_UP_PACKS: ReadonlyArray<{ id: string; priceAed: number; percent: number }> = [
  { id: 'topup_50', priceAed: 50, percent: 50 },
  { id: 'topup_100', priceAed: 100, percent: 100 },
  { id: 'topup_150', priceAed: 150, percent: 150 },
];
/** [P37] Retired packs (AED 50 +15%, AED 65 +25%, AED 100 +75%): never sold again (refused at checkout), but a
 *  checkout opened before the change still credits what it was sold for when its webhook lands. (The retired
 *  AED 85 +50% and AED 120 +100% shared ids with today's packs and credit the same share.) */
const RETIRED_TOP_UP_PERCENT: Readonly<Record<string, number>> = { topup_15: 15, topup_25: 25, topup_75: 75 };

export const TOP_UP_OPTIONS: readonly TopUpOption[] = TOP_UP_PACKS.map(({ id, priceAed, percent }) => ({
  id,
  addedAed: (DEFAULT_MONTHLY_AI_ALLOWANCE_AED * percent) / 100, // 60 → 30 / 60 / 90
  priceAed,
  label: `+${percent}%`,
}));
/** A pack that can be BOUGHT now (checkout). */
export function topUpOptionById(id: string): TopUpOption | undefined {
  return TOP_UP_OPTIONS.find((o) => o.id === id) ?? retiredOption(id);
}
/** [P37] Only the packs on sale — the checkout endpoint accepts nothing else. */
export function purchasableTopUp(id: string): TopUpOption | undefined {
  return TOP_UP_OPTIONS.find((o) => o.id === id);
}
function retiredOption(id: string): TopUpOption | undefined {
  const percent = RETIRED_TOP_UP_PERCENT[id];
  return percent === undefined ? undefined : { id, addedAed: (DEFAULT_MONTHLY_AI_ALLOWANCE_AED * percent) / 100, priceAed: 0, label: `+${percent}%` };
}
/** [P37] The allowance (AED) a confirmed top-up credits: its percent × the monthly allowance at purchase time.
 *  Covers retired pack ids too, so a checkout opened before the change is never lost. Null for an unknown id. */
export function topUpCreditAed(id: string, monthlyAllowanceAed: number): number | null {
  const percent = TOP_UP_PACKS.find((p) => p.id === id)?.percent ?? RETIRED_TOP_UP_PERCENT[id];
  return percent === undefined ? null : (monthlyAllowanceAed * percent) / 100;
}

/**
 * The AI task classes (P1-9 hybrid routing). Each has its own model setting,
 * config-overridable per class with no code change. Extraction is gate-locked to
 * Sonnet; every other class defaults to Haiku (cheaper, and non-extraction work
 * does not carry the "never guess a date" trust burden that pinned extraction).
 */
export const AI_TASK_CLASSES = [
  'extraction',
  'recall',
  'brief',
  'priorities',
  'summaries',
  'patterns',
  'drafts',
] as const;
export type AiTaskClass = (typeof AI_TASK_CLASSES)[number];

const MODEL_PROVIDERS: readonly ModelProvider[] = ['stub', 'anthropic'];
const AUTH_STORES: readonly AuthStore[] = ['memory', 'postgres'];
const TRANSCRIBER_PROVIDERS: readonly TranscriberProvider[] = ['stub', 'groq'];
const EMBEDDER_PROVIDERS: readonly EmbedderProvider[] = ['stub', 'bedrock'];
const PUSH_PROVIDERS: readonly PushProvider[] = ['stub', 'webpush'];
const EMAIL_PROVIDERS: readonly EmailProvider[] = ['stub', 'ses', 'resend'];
const CACHE_TTLS: readonly CacheTtl[] = ['5m', '1h'];

/**
 * [TRIAL-14] The trial length, in days. Product decision (locked): a FLAT 14 days, stated up front —
 * no usage-gated extension, no conditional second week. This is the single source of truth for trial
 * length; `trialDays` in the loaded config defaults to it and every trial-expiry computation derives
 * from `config.trialDays`. Was 7 with a usage-gated +7; the extension path is removed, not reconfigured.
 */
export const DEFAULT_TRIAL_DAYS = 14;

export interface AppConfig {
  databaseUrl: string;
  /** Non-superuser role connection for request queries (RLS enforced). */
  appDatabaseUrl: string;
  port: number;
  nodeEnv: string;
  // --- swap-ready provider selection (P0-2) ---
  modelProvider: ModelProvider;
  anthropicApiKey: string | undefined;
  anthropicBaseUrl: string;
  anthropicModel: string;
  /** HTTP timeout (ms) for a single model call. Sized for a REASONING-model extraction, not a
   *  non-reasoning one: worst-case wall-clock measured at 63s (~15-msg note) and 98s (5,615-msg
   *  import); default 300s covers a pathological run near the 20k-token output ceiling with headroom.
   *  Extraction runs in the background sweep (no user/ALB in the path), so a long ceiling is safe. */
  modelTimeoutMs: number;
  /**
   * Per-task-class model routing (P1-9 hybrid). extraction=Sonnet (gate-locked),
   * all other classes=Haiku by default; each overridable via MODEL_<CLASS>.
   */
  models: Record<AiTaskClass, string>;
  /** [P23-A2] Explicit effort for 5.5 models: extraction (EFFORT_EXTRACT) and every other class
   *  (EFFORT_AUX). Ignored by models without explicit effort (Sonnet 5, Haiku 4.5 — unchanged). */
  effortExtract: Effort;
  effortAux: Effort;
  /** [P23-A2] Aux thinking on models that can turn it off (Haiku 5.5): 'disabled' (default — the aux
   *  tasks are short answers/classifications, and thinking would eat their small max_tokens) or 'adaptive'. */
  auxThinking: ThinkingMode;
  /** Prompt-cache lifetime for the extraction system prefix. '1h' by default
   *  (survives longer gaps between captures); set EXTRACTION_CACHE_TTL=5m to
   *  switch to the cheaper-write 5-minute tier. */
  extractionCacheTtl: CacheTtl;
  /** [P23-B4 / EXT-10] Windowed extraction for long imported chats. OFF by default (EXTRACT_WINDOWED);
   *  over `threshold` messages a chat is read in windows of `size` overlapping by `overlap`. */
  windowing: { enabled: boolean; threshold: number; size: number; overlap: number };
  storageDir: string;
  /** [STORAGE] Blob backend: 's3' (production — the provisioned media bucket) or 'fs' (local dev).
   *  EXPLICIT, not inferred, so production can never silently fall back to ephemeral container-local
   *  disk; assertDeployReady refuses to boot a real deployment on 'fs'. */
  storageBackend: 'fs' | 's3';
  s3MediaBucket: string | undefined;
  s3Region: string | undefined;
  // --- auth (P0-3) ---
  authStore: AuthStore;
  sessionTtlHours: number;
  // --- transcription (P1-5) ---
  transcriberProvider: TranscriberProvider;
  groqApiKey: string | undefined;
  groqBaseUrl: string;
  groqModel: string;
  // --- proactive scan (P3) ---
  coldThresholdDays: number;
  // Pre-meeting nudge window (NUDGE-SCHED): fire when a meeting's start is within
  // (lead + tolerance) of now. 2h ± 15m — the tolerance absorbs a missed tick/restart
  // and lets a meeting logged <2h out still nudge, without double-sending.
  meetingNudgeLeadMinutes: number;
  meetingNudgeToleranceMinutes: number;
  reminderWindowDays: number;
  chatRefreshStaleDays: number;
  // [PROMISE-STALE] Days overdue after which an open promise goes STALE (surfacing only: off the active
  // count / claret / Today's register, still stored + searchable). 90 keeps recent misses actionable —
  // the Book Scan's headline — while retiring the truly ancient (an import's multi-year backlog).
  promiseStaleThresholdDays: number;
  // [OUTCOME-2] Days of NO activity (in either direction) after which an OPEN client is inferred lost
  // by the nightly silence rule. Derivation (NOT settled — a pilot may move it): going-cold is 30d
  // ("reach out, this is cooling") — a deal is not dead the moment it cools, so lost_inferred must sit
  // materially beyond it. 90d is 3× the cooling window and matches the existing promise-staleness
  // horizon (promiseStaleThresholdDays) — the product's existing "probably not live anymore" line.
  // "Activity" is operationalised as clients.last_touched_at (the same clock going-cold reads); true
  // per-message direction lives in extraction, which is out of this batch's scope.
  lostInferredThresholdDays: number;
  heroMinClients: number;
  heroMinNotes: number;
  // --- billing (P5) ---
  // [TRIAL-14] Trial length in days. Product decision: a FLAT 14-day trial, stated up front — no
  // usage-gated extension, no conditional second week (the old 7+7 usage extension was removed). This
  // is the single source of truth; onSignup derives trialEndsAt from it and everything else reads
  // that stored end. Overridable via TRIAL_DAYS for tests/staging; the default IS the product value.
  trialDays: number;
  /** [TRIAL-FARM] Per-TRIAL extraction ceiling — enforced pre-spend against a DURABLE monotonic
   *  counter (not prunable log rows). Derived to cover one real rep's genuine first import (~30 chat
   *  imports, one extraction each) plus ~two weeks of daily capture (~5/day × 14 ≈ 70) ≈ 100, with
   *  no meaningful headroom beyond it — a real rep never notices; a farmer's trial is near-worthless.
   *  NOTE: the AED 20 trial spend cap (trialSpendCapAed) independently bounds a trial's SPEND (now that
   *  extraction is metered), so this count ceiling is durable defense-in-depth (and the binding limit if
   *  per-extraction cost falls). Number NOT settled. */
  trialExtractionCeiling: number;
  /** [TRIAL-FARM] Per-billing-PERIOD extraction ceiling for a PAYING account (active/past_due). Far
   *  more generous than the trial ceiling — a card + real accountability — and per-period (resets each
   *  billing period) so it never locks out a long-term customer. Purely a runaway-loop backstop above
   *  what the AED spend cap allows; the spend cap is the operative paid bound. Number NOT settled. */
  paidExtractionCeiling: number;
  // --- spend cap (SPEND-CAP): a hard per-account Claude-spend failsafe, well above the modelled
  //     ~AED 19 and under the AED 67 margin ceiling, so it fires only on abuse or a defect. ---
  spendCapAed: number;
  /** [ASYNC-EXTRACT] How many notes the background sweep (the primary extraction processor) works at
   *  once. Derived for the pilot: ~10 reps importing their books at once is the target concurrency; a
   *  pool of 5 drains each fairness-column of up to 10 reps in ~2 cycles while staying well under the
   *  Bedrock per-model rate limit (and one arm64 container's headroom — extraction is I/O-bound on the
   *  model call, not CPU). Higher risks provider 429s; lower reintroduces the day-one backlog. Tunable
   *  via SWEEP_CONCURRENCY; NOT settled — revisit against real Bedrock TPM/RPM at pilot scale. */
  sweepConcurrency: number;
  /** [TRIAL-FARM] The spend cap for a TRIALING account — far tighter than the paying-account failsafe.
   *  The AED 45 cap was derived as a PAYING month's cost guard (COGS ~AED 43–48); reusing it for a
   *  14-day trial lets one trial burn most of a paying month's budget before anyone pays. Sized against
   *  the NOW-METERED pricing (callCostUsd, Sonnet — trials route to Sonnet; see trial-cost.test.ts):
   *  a realistic first fortnight (~30 imported chats + ~5 daily notes/day × 14) ≈ AED 6.3, and a
   *  heavy-BUT-LEGIT rep (~40 big chats + ~10 notes/day) ≈ AED 15.3. At **AED 20**: a normal fortnight
   *  uses ~a third of the cap, the heavy-legit case clears with margin (so the most engaged prospect
   *  isn't the one throttled), and per-inbox farming value stays under HALF the old AED 45 exposure.
   *  (Was 15 — raised because 15.3 would have throttled the heaviest legitimate trial, the wrong person.)
   *  Enforced pre-spend, degrade-not-break. NOT settled. */
  trialSpendCapAed: number;
  spendWarnFraction: number;
  /** [USAGE-ALLOWANCE · D1] Each rep's monthly AI-cost allowance (100%). Derivation: AED 60 ≈ 20% of the
   *  AED 299 subscription: the most AI cost one seat may consume per month. Raised from 40 on 2026-10-05
   *  after the two-call pointer split raised per-import cost. Overridable via MONTHLY_AI_ALLOWANCE_AED;
   *  the default (DEFAULT_MONTHLY_AI_ALLOWANCE_AED) IS the product value. */
  monthlyAiAllowanceAed: number;
  /** [USAGE-ALLOWANCE · D13] Global monthly AI-spend ALERT threshold. When total spend this calendar
   *  month crosses it, the owner is emailed ONCE. It NEVER blocks or pauses anything (the global ceiling
   *  was removed). Derivation: beta of ~3 reps × AED 40 + founder testing + headroom; raise deliberately
   *  as paying users grow. Read from config so it changes without a deploy. */
  aiSpendAlertAed: number;
  /** [USAGE-ALLOWANCE · D14] Manual platform-wide kill switch. When true, every metered AI call is
   *  refused immediately (erasure re-summarisation is the sole exemption — a legal obligation). For when
   *  the owner sees something wrong and needs AI to stop now. */
  aiPaused: boolean;
  // --- UAE VAT (VAT-READY): fully built, OFF by default. Flip on the day Prospera registers.
  //     An invoice's tax status is date-driven (see VatPolicy), so the boundary is immutable. ---
  vatRegistered: boolean;
  /** [BETA-7] Public self-registration (/auth/signup). Default OFF — beta is request-and-invite only.
   *  Set SIGNUP_ENABLED=true only to re-open self-serve signup. */
  signupEnabled: boolean;
  vatTrn: string | undefined;
  vatRate: number;
  vatRegisteredFromMs: number | null;
  /** Ops token for the /ops/* endpoints (cap override). Unset → the ops routes are disabled (403). */
  opsToken: string | undefined;
  /** [BETA-3] Owner address that receives new beta access-request notifications. Unset → no email is
   *  sent (the request is still recorded); set it to the operator's inbox in any env that takes signups. */
  accessRequestNotifyEmail: string | undefined;
  stripeWebhookSecret: string;
  stripeSecretKey: string | undefined;
  stripePriceId: string;
  stripeAnnualPriceId: string;
  stripeSuccessUrl: string;
  stripeCancelUrl: string;
  // --- cloud adapters (P6-2) ---
  embedderProvider: EmbedderProvider;
  bedrockRegion: string;
  embedModel: string;
  /** Embedding vector dimension (Titan-v2 supports 256/512/1024). MUST match the
   *  notes.embedding pgvector column; changing it needs a migration + full re-embed. */
  embedDim: number;
  pushProvider: PushProvider;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  // --- transactional email (TASK EMAIL) ---
  emailProvider: EmailProvider;
  emailFrom: string;
  resendApiKey: string | undefined;
  sesRegion: string;
  /** Public base URL of the app (for links inside emails, e.g. password reset). */
  appBaseUrl: string;
}

type Env = Record<string, string | undefined>;

const REQUIRED = ['DATABASE_URL'] as const;

function isBlank(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

export function loadConfig(env: Env = process.env): AppConfig {
  const missing = REQUIRED.filter((key) => isBlank(env[key]));
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `Copy .env.example to .env (or set them in your environment) and try again.`,
    );
  }

  const port = parsePort(env.PORT);
  // Checkout redirects default to the app itself, so setting APP_BASE_URL is
  // enough — no separate STRIPE_SUCCESS_URL/CANCEL_URL to keep in sync in prod.
  // [P30] No trailing slash: invite/reset/verify links and the Stripe return URLs append "/path" to it.
  const appBaseUrl = (env.APP_BASE_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '');

  return {
    databaseUrl: env.DATABASE_URL!.trim(),
    // Falls back to the primary URL when unset (RLS then relies on the app-layer
    // filter only); set APP_DATABASE_URL to the tovira_app role for the DB net.
    appDatabaseUrl: isBlank(env.APP_DATABASE_URL) ? env.DATABASE_URL!.trim() : env.APP_DATABASE_URL!.trim(),
    port,
    nodeEnv: env.NODE_ENV?.trim() || 'development',
    modelProvider: parseModelProvider(env.MODEL_PROVIDER),
    anthropicApiKey: isBlank(env.ANTHROPIC_API_KEY) ? undefined : env.ANTHROPIC_API_KEY!.trim(),
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com',
    // P1-9 gate decision (run against real models 2026-07-12): Haiku 4.5 hit
    // full recall but GUESSED a date that should have been null — it fails the
    // "never guess a date" trust rule. Sonnet 5 passed clean (0 fabricated,
    // 0 guessed). Extraction defaults to Sonnet; override with ANTHROPIC_MODEL.
    anthropicModel: env.MODEL_EXTRACT?.trim() || env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5',
    // [EXTRACT-TIMEOUT] 30s aborted reasoning extractions (measured 63s / 98s) — raised to 300s.
    modelTimeoutMs: parsePositive(env.MODEL_TIMEOUT_MS, 300_000, 'MODEL_TIMEOUT_MS'),
    models: resolveModels(env),
    effortExtract: parseEnum(env.EFFORT_EXTRACT, EFFORTS, 'low', 'EFFORT_EXTRACT'),
    effortAux: parseEnum(env.EFFORT_AUX, EFFORTS, 'low', 'EFFORT_AUX'),
    auxThinking: parseEnum(env.AUX_THINKING, ['adaptive', 'disabled'] as const, 'disabled', 'AUX_THINKING'),
    extractionCacheTtl: parseEnum(env.EXTRACTION_CACHE_TTL, CACHE_TTLS, '1h', 'EXTRACTION_CACHE_TTL'),
    windowing: parseWindowing(env),
    storageDir: env.STORAGE_DIR?.trim() || './.data/storage',
    storageBackend: env.STORAGE_BACKEND?.trim() === 's3' ? 's3' : 'fs',
    s3MediaBucket: isBlank(env.S3_MEDIA_BUCKET) ? undefined : env.S3_MEDIA_BUCKET!.trim(),
    s3Region: (env.S3_REGION ?? env.AWS_REGION)?.trim() || undefined,
    authStore: parseAuthStore(env.AUTH_STORE),
    sessionTtlHours: parseSessionTtlHours(env.SESSION_TTL_HOURS),
    transcriberProvider: parseTranscriberProvider(env.TRANSCRIBER),
    groqApiKey: isBlank(env.GROQ_API_KEY) ? undefined : env.GROQ_API_KEY!.trim(),
    groqBaseUrl: env.GROQ_BASE_URL?.trim() || 'https://api.groq.com',
    groqModel: env.GROQ_MODEL?.trim() || 'whisper-large-v3',
    coldThresholdDays: parsePositive(env.COLD_THRESHOLD_DAYS, 30, 'COLD_THRESHOLD_DAYS'),
    meetingNudgeLeadMinutes: parsePositive(env.MEETING_NUDGE_LEAD_MINUTES, 120, 'MEETING_NUDGE_LEAD_MINUTES'),
    meetingNudgeToleranceMinutes: parsePositive(env.MEETING_NUDGE_TOLERANCE_MINUTES, 15, 'MEETING_NUDGE_TOLERANCE_MINUTES'),
    reminderWindowDays: parsePositive(env.REMINDER_WINDOW_DAYS, 7, 'REMINDER_WINDOW_DAYS'),
    chatRefreshStaleDays: parsePositive(env.CHAT_REFRESH_STALE_DAYS, 21, 'CHAT_REFRESH_STALE_DAYS'),
    promiseStaleThresholdDays: parsePositive(env.PROMISE_STALE_THRESHOLD_DAYS, 90, 'PROMISE_STALE_THRESHOLD_DAYS'),
    // [OUTCOME-2] default 90 — derivation recorded on the interface field above (not settled).
    lostInferredThresholdDays: parsePositive(env.LOST_INFERRED_THRESHOLD_DAYS, 90, 'LOST_INFERRED_THRESHOLD_DAYS'),
    heroMinClients: parsePositive(env.HERO_MIN_CLIENTS, 5, 'HERO_MIN_CLIENTS'),
    heroMinNotes: parsePositive(env.HERO_MIN_NOTES, 20, 'HERO_MIN_NOTES'),
    trialDays: parsePositive(env.TRIAL_DAYS, DEFAULT_TRIAL_DAYS, 'TRIAL_DAYS'),
    trialExtractionCeiling: parsePositive(env.TRIAL_EXTRACTION_CEILING, 100, 'TRIAL_EXTRACTION_CEILING'),
    paidExtractionCeiling: parsePositive(env.PAID_EXTRACTION_CEILING, 2000, 'PAID_EXTRACTION_CEILING'),
    spendCapAed: parsePositive(env.SPEND_CAP_AED, 45, 'SPEND_CAP_AED'),
    sweepConcurrency: parsePositive(env.SWEEP_CONCURRENCY, 5, 'SWEEP_CONCURRENCY'),
    trialSpendCapAed: parsePositive(env.TRIAL_SPEND_CAP_AED, 20, 'TRIAL_SPEND_CAP_AED'),
    spendWarnFraction: parsePositive(env.SPEND_WARN_FRACTION, 0.8, 'SPEND_WARN_FRACTION'),
    monthlyAiAllowanceAed: parsePositive(env.MONTHLY_AI_ALLOWANCE_AED, DEFAULT_MONTHLY_AI_ALLOWANCE_AED, 'MONTHLY_AI_ALLOWANCE_AED'),
    aiSpendAlertAed: parsePositive(env.AI_SPEND_ALERT_AED, 300, 'AI_SPEND_ALERT_AED'),
    aiPaused: env.AI_PAUSED?.trim() === 'true', // default false (undefined → not paused)
    opsToken: isBlank(env.OPS_TOKEN) ? undefined : env.OPS_TOKEN!.trim(),
    accessRequestNotifyEmail: isBlank(env.ACCESS_REQUEST_NOTIFY_TO) ? undefined : env.ACCESS_REQUEST_NOTIFY_TO!.trim(),
    vatRegistered: env.VAT_REGISTERED?.trim() === 'true',
    signupEnabled: env.SIGNUP_ENABLED?.trim() === 'true', // default false (undefined → off)
    vatTrn: isBlank(env.VAT_TRN) ? undefined : env.VAT_TRN!.trim(),
    vatRate: parsePositive(env.VAT_RATE, 0.05, 'VAT_RATE'),
    vatRegisteredFromMs: parseDateOrNull(env.VAT_REGISTERED_FROM, 'VAT_REGISTERED_FROM'),
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || 'whsec_test',
    stripeSecretKey: isBlank(env.STRIPE_SECRET_KEY) ? undefined : env.STRIPE_SECRET_KEY!.trim(),
    stripePriceId: env.STRIPE_PRICE_ID?.trim() || 'price_test',
    stripeAnnualPriceId: env.STRIPE_ANNUAL_PRICE_ID?.trim() || 'price_test_annual',
    stripeSuccessUrl: env.STRIPE_SUCCESS_URL?.trim() || `${appBaseUrl}/billing/success`,
    stripeCancelUrl: env.STRIPE_CANCEL_URL?.trim() || `${appBaseUrl}/billing/cancel`,
    embedderProvider: parseEnum(env.EMBEDDER, EMBEDDER_PROVIDERS, 'stub', 'EMBEDDER'),
    bedrockRegion: env.BEDROCK_REGION?.trim() || 'us-east-1',
    embedModel: env.EMBED_MODEL?.trim() || 'amazon.titan-embed-text-v2:0',
    embedDim: parseEmbedDim(env.EMBED_DIM),
    pushProvider: parseEnum(env.PUSH_SENDER, PUSH_PROVIDERS, 'stub', 'PUSH_SENDER'),
    vapidPublicKey: env.VAPID_PUBLIC_KEY?.trim() || '',
    vapidPrivateKey: env.VAPID_PRIVATE_KEY?.trim() || '',
    vapidSubject: env.VAPID_SUBJECT?.trim() || 'mailto:ops@tovira.local',
    emailProvider: parseEnum(env.EMAIL_SENDER, EMAIL_PROVIDERS, 'stub', 'EMAIL_SENDER'),
    // [P22-2] No placeholder sender: EMAIL_FROM comes only from env (assertDeployReady requires it for a
    // real provider). Empty for local/stub, where nothing is sent.
    emailFrom: env.EMAIL_FROM?.trim() || '',
    resendApiKey: isBlank(env.RESEND_API_KEY) ? undefined : env.RESEND_API_KEY!.trim(),
    sesRegion: env.SES_REGION?.trim() || env.BEDROCK_REGION?.trim() || 'us-east-1',
    appBaseUrl,
  };
}

/**
 * Deploy-readiness audit (DEPLOY-READY). Fails FAST with a single, named list of
 * every key that is missing or still a local placeholder — but ONLY for the
 * providers actually turned on. Local dev (all-stub) stays zero-config; the
 * moment a real provider is selected, its keys become mandatory.
 *
 * Call this at boot AFTER {@link loadConfig}. It is intentionally separate so the
 * unit tests (which run against stub providers) don't have to satisfy prod keys.
 */
/**
 * [OPS-VISIBILITY] In production, a missing OPS_TOKEN silently disables the entire ops surface (every
 * /ops/* → 403, the identifying /health body gated off). Fail-closed is CORRECT — an unset token must
 * never open the routes — but a *silent* dark surface goes unnoticed for months. This is NOT a hard
 * boot failure (fail-closed is safe to run), so it returns a loud warning to log at boot rather than
 * throwing; public /health also reports `opsConfigured:false` so the first curl reveals it. Returns
 * the warning string when prod + no token, else undefined (dev, or token set).
 */
export function opsSurfaceWarning(config: Pick<AppConfig, 'nodeEnv' | 'opsToken'>): string | undefined {
  if (config.nodeEnv === 'production' && !config.opsToken) {
    return '[ops] WARNING: OPS_TOKEN is not set in production — every /ops/* route returns 403 and /health exposes liveness only (opsConfigured:false). The ops surface is DARK. Set OPS_TOKEN in Secrets Manager (tovira/<env>/app) and wire it into the task definition.';
  }
  return undefined;
}

export function assertDeployReady(config: AppConfig, env: Env = process.env): void {
  const missing: string[] = [];
  const need = (cond: boolean, keyAndWhy: string): void => {
    if (cond) missing.push(keyAndWhy);
  };
  const looksLocal = (url: string): boolean => /localhost|127\.0\.0\.1/.test(url);

  // --- AI (extraction/recall/brief/…): a real model provider needs a key ---
  need(config.modelProvider === 'anthropic' && !config.anthropicApiKey, 'ANTHROPIC_API_KEY (MODEL_PROVIDER=anthropic)');
  // Every task class must resolve to a non-empty model id.
  for (const cls of AI_TASK_CLASSES) {
    need(isBlank(config.models[cls]), `MODEL_${cls.toUpperCase()} (model id must not be blank)`);
  }

  // --- Embeddings (recall + semantic search) ---
  // A real AI model provider paired with a STUB embedder is a HALF-REAL config: it
  // boots quietly and then silently returns nothing for recall and semantic search.
  // Refuse it so staging/prod can never be non-representative without someone noticing.
  need(config.modelProvider === 'anthropic' && config.embedderProvider === 'stub',
    "EMBEDDER (must be a real provider such as 'bedrock', not 'stub', when MODEL_PROVIDER is real — recall and semantic search return nothing with a stub embedder)");

  // --- Speech-to-text ---
  need(config.transcriberProvider === 'groq' && !config.groqApiKey, 'GROQ_API_KEY (TRANSCRIBER=groq)');

  // --- Web push ---
  if (config.pushProvider === 'webpush') {
    need(isBlank(config.vapidPublicKey), 'VAPID_PUBLIC_KEY (PUSH_SENDER=webpush)');
    need(isBlank(config.vapidPrivateKey), 'VAPID_PRIVATE_KEY (PUSH_SENDER=webpush)');
  }

  // --- Transactional email (SES) ---
  if (config.emailProvider === 'ses') {
    need(isBlank(env.SES_REGION), 'SES_REGION (EMAIL_SENDER=ses)');
    need(isBlank(config.emailFrom) || /\.local\b/.test(config.emailFrom), 'EMAIL_FROM (a verified SES sender, not a *.local placeholder)');
    need(looksLocal(config.appBaseUrl), 'APP_BASE_URL (a public URL — it becomes the link inside every email)');
  }
  if (config.emailProvider === 'resend') {
    need(!config.resendApiKey, 'RESEND_API_KEY (EMAIL_SENDER=resend)');
    need(isBlank(config.emailFrom) || /\.local\b/.test(config.emailFrom), 'EMAIL_FROM (a verified Resend sender, not a *.local placeholder)');
    need(looksLocal(config.appBaseUrl), 'APP_BASE_URL (a public URL — it becomes the link inside every email)');
  }

  // --- Billing: once a real secret key is present, the rest must be real too ---
  if (config.stripeSecretKey) {
    need(isBlank(config.stripeWebhookSecret) || config.stripeWebhookSecret === 'whsec_test', 'STRIPE_WEBHOOK_SECRET (still the test placeholder)');
    need(isBlank(config.stripePriceId) || config.stripePriceId === 'price_test', 'STRIPE_PRICE_ID (still the test placeholder)');
    need(isBlank(config.stripeAnnualPriceId) || config.stripeAnnualPriceId === 'price_test_annual', 'STRIPE_ANNUAL_PRICE_ID (still the test placeholder)');
  }

  // --- UAE VAT: a half-configured VAT state is worse than none (VAT-READY). If registration is on,
  //     the TRN and the registration date are BOTH mandatory — without them we would issue
  //     non-compliant tax invoices or reclassify by an undefined boundary. Refuse to boot.
  if (config.vatRegistered) {
    need(isBlank(config.vatTrn), 'VAT_TRN (VAT_REGISTERED=true requires the Prospera TRN on every tax invoice)');
    need(config.vatRegisteredFromMs === null, 'VAT_REGISTERED_FROM (VAT_REGISTERED=true requires the registration date — the immutable tax boundary)');
  }


  // --- Blob storage (STORAGE): media must be DURABLE in any real deployment. Ephemeral Fargate
  //     local disk loses every recording on deploy/scale-in/crash. If the environment looks like a
  //     real deployment (a real model or email provider is on, or the app URL is public), the backend
  //     MUST be s3 — never 'fs'. This makes running production on the filesystem impossible by accident.
  const looksDeployed = config.modelProvider !== 'stub' || config.emailProvider !== 'stub' || !looksLocal(config.appBaseUrl);
  need(looksDeployed && config.storageBackend !== 's3',
    'STORAGE_BACKEND=s3 (a real deployment must not keep media on ephemeral container-local disk — it is lost on every deploy/scale-in/crash; set STORAGE_BACKEND=s3)');
  if (config.storageBackend === 's3') {
    need(isBlank(config.s3MediaBucket), 'S3_MEDIA_BUCKET (STORAGE_BACKEND=s3 — the bucket holding audio/ and images/)');
    need(isBlank(config.s3Region), 'S3_REGION or AWS_REGION (STORAGE_BACKEND=s3)');
  }

  // --- [P22-2] Domains: the app URL and the sender come ONLY from env, and only on a domain we own. A
  //     deployment never silently links to localhost, and nothing may name the .com of our name (someone
  //     else's live site). Fail at startup rather than send a stranger's link in every email.
  need(looksDeployed && isBlank(env.APP_BASE_URL), 'APP_BASE_URL (required in a deployment — it becomes the link inside every email; there is no fallback)');
  const FOREIGN_DOMAIN = new RegExp(['tovira', 'com'].join('\\.') + '\\b', 'i');
  need(FOREIGN_DOMAIN.test(config.appBaseUrl), 'APP_BASE_URL (points at a domain we do not own — use our own app URL)');
  need(FOREIGN_DOMAIN.test(config.emailFrom), 'EMAIL_FROM (a sender on a domain we do not own — use hello@tovira.io)');

  if (missing.length > 0) {
    throw new ConfigError(
      `Configuration is not deploy-ready. Fix these before starting with real providers:\n  - ${missing.join('\n  - ')}`,
    );
  }
}

/**
 * A boot/health-time summary of which pluggable adapters are REAL vs STUB, so
 * "staging is representative" is verifiable rather than assumed (STAGING-EMBEDDER).
 * Logged at startup and surfaced on the health endpoint.
 */
/** [P22-3] What every email will actually use: provider, From, Reply-To and the origin every link is
 *  built from. Non-secret by nature — all four appear in every email sent. Logged at boot and shown on the
 *  ops-gated /health, so "what does live send" is answerable without reading a secret. */
export interface EmailConfigSummary { provider: EmailProvider; from: string; replyTo: string; appOrigin: string }
export function emailConfigSummary(config: Pick<AppConfig, 'emailProvider' | 'emailFrom' | 'appBaseUrl'>): EmailConfigSummary {
  let appOrigin: string;
  try { appOrigin = new URL(config.appBaseUrl).origin; } catch { appOrigin = config.appBaseUrl; }
  return { provider: config.emailProvider, from: config.emailFrom || '(unset)', replyTo: CONTACT_EMAIL, appOrigin };
}

export function describeAdapters(config: AppConfig): Record<'model' | 'embedder' | 'transcriber' | 'push' | 'email', 'live' | 'stub'> {
  const mode = (isReal: boolean): 'live' | 'stub' => (isReal ? 'live' : 'stub');
  return {
    model: mode(config.modelProvider !== 'stub'),
    embedder: mode(config.embedderProvider !== 'stub'),
    transcriber: mode(config.transcriberProvider !== 'stub'),
    push: mode(config.pushProvider !== 'stub'),
    email: mode(config.emailProvider !== 'stub'),
  };
}

/**
 * Resolve the per-class model map. Extraction inherits ANTHROPIC_MODEL (Sonnet by
 * default — the P1-9 gate lock); every other class inherits HAIKU_MODEL (Haiku
 * 4.5 by default). A `MODEL_<CLASS>` var (e.g. MODEL_RECALL, MODEL_DRAFTS)
 * overrides a single class with no code change and beats the family default.
 */
function resolveModels(env: Env): Record<AiTaskClass, string> {
  // [P23-A2] MODEL_EXTRACT / MODEL_AUX are the family switches; the older names still work beneath them.
  const extractionModel = env.MODEL_EXTRACT?.trim() || env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5';
  const haikuModel = env.MODEL_AUX?.trim() || env.HAIKU_MODEL?.trim() || 'claude-haiku-4-5-20251001';
  const out = {} as Record<AiTaskClass, string>;
  for (const cls of AI_TASK_CLASSES) {
    const family = cls === 'extraction' ? extractionModel : haikuModel;
    const override = env[`MODEL_${cls.toUpperCase()}`]?.trim();
    out[cls] = override || family;
  }
  return out;
}

function parseEnum<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T, name: string): T {
  if (isBlank(raw)) return fallback;
  const value = raw!.trim() as T;
  if (!allowed.includes(value)) throw new ConfigError(`Invalid ${name}: "${value}". Expected one of: ${allowed.join(', ')}.`);
  return value;
}

/** [P23-B4] EXTRACT_WINDOWED (0/1/true/false, default off) + N/W/O, validated: overlap < size. */
function parseWindowing(env: Env): AppConfig['windowing'] {
  const raw = env.EXTRACT_WINDOWED?.trim().toLowerCase();
  if (raw && !['0', '1', 'true', 'false'].includes(raw)) throw new ConfigError(`Invalid EXTRACT_WINDOWED: "${env.EXTRACT_WINDOWED}". Expected 1/0/true/false.`);
  const size = parsePositive(env.EXTRACT_WINDOW_SIZE, 120, 'EXTRACT_WINDOW_SIZE');
  const overlapRaw = env.EXTRACT_WINDOW_OVERLAP?.trim();
  const overlap = overlapRaw ? Number(overlapRaw) : 20;
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= size) throw new ConfigError(`Invalid EXTRACT_WINDOW_OVERLAP: "${overlapRaw ?? overlap}". Expected a whole number ≥ 0 and smaller than EXTRACT_WINDOW_SIZE (${size}).`);
  return { enabled: raw === '1' || raw === 'true', threshold: parsePositive(env.EXTRACT_WINDOW_THRESHOLD, 150, 'EXTRACT_WINDOW_THRESHOLD'), size, overlap };
}

function parsePositive(raw: string | undefined, fallback: number, name: string): number {
  if (isBlank(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`Invalid ${name}: "${raw}". Expected a positive number.`);
  return n;
}

/** A date (YYYY-MM-DD or ISO) → epoch ms, or null when blank. Invalid → fail fast (VAT-READY). */
function parseDateOrNull(raw: string | undefined, name: string): number | null {
  if (isBlank(raw)) return null;
  const ms = Date.parse(raw!.trim());
  if (!Number.isFinite(ms)) throw new ConfigError(`Invalid ${name}: "${raw}". Expected a date like 2026-11-01.`);
  return ms;
}

function parseTranscriberProvider(raw: string | undefined): TranscriberProvider {
  if (isBlank(raw)) return 'stub';
  const value = raw!.trim();
  if (!TRANSCRIBER_PROVIDERS.includes(value as TranscriberProvider)) {
    throw new ConfigError(`Invalid TRANSCRIBER: "${value}". Expected one of: ${TRANSCRIBER_PROVIDERS.join(', ')}.`);
  }
  return value as TranscriberProvider;
}

function parseAuthStore(raw: string | undefined): AuthStore {
  if (isBlank(raw)) return 'postgres';
  const value = raw!.trim();
  if (!AUTH_STORES.includes(value as AuthStore)) {
    throw new ConfigError(`Invalid AUTH_STORE: "${value}". Expected one of: ${AUTH_STORES.join(', ')}.`);
  }
  return value as AuthStore;
}

function parseSessionTtlHours(raw: string | undefined): number {
  if (isBlank(raw)) return 168; // 7 days
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ConfigError(`Invalid SESSION_TTL_HOURS: "${raw}". Expected a positive number.`);
  }
  return n;
}

/**
 * Embedding dimension. Titan-v2 supports 256/512/1024. Default 512: half the storage
 * and ANN-index working set of 1024 (the pgvector index keeps its own vector copy plus
 * graph links, so resident RAM is ~2x the raw bytes) — paired with a db.t4g.medium
 * target for real load. Negligible retrieval-quality loss. MUST match the
 * notes.embedding pgvector column — changing it needs a migration + full re-embed.
 */
function parseEmbedDim(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return 512;
  const n = Number(value);
  if (![256, 512, 1024].includes(n)) {
    throw new ConfigError(`Invalid EMBED_DIM: "${value}". Expected one of: 256, 512, 1024.`);
  }
  return n;
}

function parseModelProvider(raw: string | undefined): ModelProvider {
  if (isBlank(raw)) return 'stub';
  const value = raw!.trim();
  if (!MODEL_PROVIDERS.includes(value as ModelProvider)) {
    throw new ConfigError(
      `Invalid MODEL_PROVIDER: "${value}". Expected one of: ${MODEL_PROVIDERS.join(', ')}.`,
    );
  }
  return value as ModelProvider;
}

function parsePort(raw: string | undefined): number {
  if (isBlank(raw)) return 3001;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new ConfigError(`Invalid PORT: "${raw}". Expected an integer between 1 and 65535.`);
  }
  return n;
}
