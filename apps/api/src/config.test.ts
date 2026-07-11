import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from './config.js';

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
});
