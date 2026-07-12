/**
 * Application configuration, loaded and validated once at boot.
 *
 * Principle (P0-1): a missing/invalid required var must fail FAST with a named,
 * actionable error — never a silent crash or a half-up service.
 */

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export type ModelProvider = 'stub' | 'anthropic';
export type AuthStore = 'memory' | 'postgres';
export type TranscriberProvider = 'stub' | 'groq';

const MODEL_PROVIDERS: readonly ModelProvider[] = ['stub', 'anthropic'];
const AUTH_STORES: readonly AuthStore[] = ['memory', 'postgres'];
const TRANSCRIBER_PROVIDERS: readonly TranscriberProvider[] = ['stub', 'groq'];

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
  nudgeLeadHours: number;
  reminderWindowDays: number;
  heroMinClients: number;
  heroMinNotes: number;
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
    anthropicModel: env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5-20251001',
    storageDir: env.STORAGE_DIR?.trim() || './.data/storage',
    authStore: parseAuthStore(env.AUTH_STORE),
    sessionTtlHours: parseSessionTtlHours(env.SESSION_TTL_HOURS),
    transcriberProvider: parseTranscriberProvider(env.TRANSCRIBER),
    groqApiKey: isBlank(env.GROQ_API_KEY) ? undefined : env.GROQ_API_KEY!.trim(),
    groqBaseUrl: env.GROQ_BASE_URL?.trim() || 'https://api.groq.com',
    groqModel: env.GROQ_MODEL?.trim() || 'whisper-large-v3',
    coldThresholdDays: parsePositive(env.COLD_THRESHOLD_DAYS, 30, 'COLD_THRESHOLD_DAYS'),
    nudgeLeadHours: parsePositive(env.NUDGE_LEAD_HOURS, 24, 'NUDGE_LEAD_HOURS'),
    reminderWindowDays: parsePositive(env.REMINDER_WINDOW_DAYS, 7, 'REMINDER_WINDOW_DAYS'),
    heroMinClients: parsePositive(env.HERO_MIN_CLIENTS, 5, 'HERO_MIN_CLIENTS'),
    heroMinNotes: parsePositive(env.HERO_MIN_NOTES, 20, 'HERO_MIN_NOTES'),
  };
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
