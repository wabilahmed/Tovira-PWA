import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError, DEFAULT_TRIAL_DAYS } from './config.js';

// [P0-1] "Start with a required env var missing → stack fails fast with a named,
// actionable error, not a silent crash or a half-up state."
describe('loadConfig', () => {
  const valid = {
    DATABASE_URL: 'postgres://tovira:tovira@localhost:5432/tovira',
    PORT: '3001',
    NODE_ENV: 'development',
  };

  it('returns a typed config from a valid environment', () => {
    const cfg = loadConfig(valid);
    expect(cfg.databaseUrl).toBe(valid.DATABASE_URL);
    expect(cfg.port).toBe(3001);
    expect(cfg.nodeEnv).toBe('development');
  });

  // [TRIAL-14] Single source of truth: the trial is a FLAT 14 days by default (product decision).
  it('defaults the trial to a flat 14 days', () => {
    expect(DEFAULT_TRIAL_DAYS).toBe(14);
    expect(loadConfig(valid).trialDays).toBe(14);
    expect(loadConfig({ ...valid, TRIAL_DAYS: '21' }).trialDays).toBe(21); // still overridable for tests/staging
  });

  it('applies sensible defaults for optional vars', () => {
    const cfg = loadConfig({ DATABASE_URL: valid.DATABASE_URL });
    expect(cfg.port).toBe(3001);
    expect(cfg.nodeEnv).toBe('development');
  });

  // NEGATIVE: fail fast, and the error must NAME the missing var (actionable).
  it('throws a named, actionable error when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('treats a blank/whitespace required var as missing', () => {
    expect(() => loadConfig({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL/);
  });

  it('lists every missing required var in one message', () => {
    try {
      loadConfig({});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toMatch(/DATABASE_URL/);
    }
  });

  // NEGATIVE: a malformed value fails fast too, rather than silently coercing.
  it('rejects a non-numeric PORT with a named error', () => {
    expect(() => loadConfig({ ...valid, PORT: 'not-a-number' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...valid, PORT: 'not-a-number' })).toThrow(/PORT/);
  });

  // [P0-2] provider selectors — default to keyless local stand-ins.
  it('defaults the model provider to the keyless stub', () => {
    expect(loadConfig(valid).modelProvider).toBe('stub');
  });

  it('reads the model provider from MODEL_PROVIDER', () => {
    expect(loadConfig({ ...valid, MODEL_PROVIDER: 'anthropic' }).modelProvider).toBe('anthropic');
  });

  // [EXTRACT-TIMEOUT] A reasoning-model extraction runs far longer than a non-reasoning one: measured
  // 63s (a ~15-msg note) and 98s (a 5,615-msg import) wall-clock. The old 30s adapter default aborted
  // them ("model request failed"), the SAME decay class as max_tokens. Default must comfortably cover
  // the worst real call.
  it('defaults the model timeout to 300s (covers the measured reasoning-extraction worst case)', () => {
    expect(loadConfig(valid).modelTimeoutMs).toBe(300_000);
  });

  it('reads MODEL_TIMEOUT_MS as an override', () => {
    expect(loadConfig({ ...valid, MODEL_TIMEOUT_MS: '120000' }).modelTimeoutMs).toBe(120_000);
  });

  it('rejects a non-numeric MODEL_TIMEOUT_MS with a named error', () => {
    expect(() => loadConfig({ ...valid, MODEL_TIMEOUT_MS: 'soon' })).toThrow(/MODEL_TIMEOUT_MS/);
  });

  it('rejects an unknown model provider with a named error', () => {
    expect(() => loadConfig({ ...valid, MODEL_PROVIDER: 'gpt' })).toThrow(/MODEL_PROVIDER/);
  });

  // [P0-4] app-role connection for RLS enforcement.
  it('defaults appDatabaseUrl to the primary DATABASE_URL when unset', () => {
    expect(loadConfig(valid).appDatabaseUrl).toBe(valid.DATABASE_URL);
  });

  it('uses APP_DATABASE_URL (the non-superuser role) when provided', () => {
    const appUrl = 'postgres://tovira_app:tovira_app@localhost:5432/tovira';
    expect(loadConfig({ ...valid, APP_DATABASE_URL: appUrl }).appDatabaseUrl).toBe(appUrl);
  });

  // [CACHE] the extraction prompt-cache TTL switch: 1h by default, 5m on demand.
  it('defaults the extraction cache TTL to 1h', () => {
    expect(loadConfig(valid).extractionCacheTtl).toBe('1h');
  });

  it('switches to the 5-minute tier via EXTRACTION_CACHE_TTL=5m', () => {
    expect(loadConfig({ ...valid, EXTRACTION_CACHE_TTL: '5m' }).extractionCacheTtl).toBe('5m');
  });

  it('rejects an invalid EXTRACTION_CACHE_TTL with a named error', () => {
    expect(() => loadConfig({ ...valid, EXTRACTION_CACHE_TTL: '30m' })).toThrow(/EXTRACTION_CACHE_TTL/);
  });
});
