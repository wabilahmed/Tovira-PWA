/**
 * Application configuration, loaded and validated once at boot.
 *
 * Principle (P0-1): a missing/invalid required var must fail FAST with a named,
 * actionable error — never a silent crash or a half-up service.
 */

import type { CacheTtl } from './ports/model.js';

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
  /**
   * Per-task-class model routing (P1-9 hybrid). extraction=Sonnet (gate-locked),
   * all other classes=Haiku by default; each overridable via MODEL_<CLASS>.
   */
  models: Record<AiTaskClass, string>;
  /** Prompt-cache lifetime for the extraction system prefix. '1h' by default
   *  (survives longer gaps between captures); set EXTRACTION_CACHE_TTL=5m to
   *  switch to the cheaper-write 5-minute tier. */
  extractionCacheTtl: CacheTtl;
  storageDir: string;
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
  heroMinClients: number;
  heroMinNotes: number;
  // --- billing (P5) ---
  trialDays: number;
  trialExtractionCeiling: number;
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
  const appBaseUrl = env.APP_BASE_URL?.trim() || 'http://localhost:5173';

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
    anthropicModel: env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5',
    models: resolveModels(env),
    extractionCacheTtl: parseEnum(env.EXTRACTION_CACHE_TTL, CACHE_TTLS, '1h', 'EXTRACTION_CACHE_TTL'),
    storageDir: env.STORAGE_DIR?.trim() || './.data/storage',
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
    heroMinClients: parsePositive(env.HERO_MIN_CLIENTS, 5, 'HERO_MIN_CLIENTS'),
    heroMinNotes: parsePositive(env.HERO_MIN_NOTES, 20, 'HERO_MIN_NOTES'),
    trialDays: parsePositive(env.TRIAL_DAYS, 7, 'TRIAL_DAYS'),
    trialExtractionCeiling: parsePositive(env.TRIAL_EXTRACTION_CEILING, 200, 'TRIAL_EXTRACTION_CEILING'),
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
    emailFrom: env.EMAIL_FROM?.trim() || 'Tovira <no-reply@tovira.local>',
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
  const extractionModel = env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5';
  const haikuModel = env.HAIKU_MODEL?.trim() || 'claude-haiku-4-5-20251001';
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

function parsePositive(raw: string | undefined, fallback: number, name: string): number {
  if (isBlank(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`Invalid ${name}: "${raw}". Expected a positive number.`);
  return n;
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
