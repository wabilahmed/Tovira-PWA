import { describe, it, expect } from 'vitest';
import { loadConfig, assertDeployReady, describeAdapters, ConfigError } from './config.js';

// [DEPLOY-READY] the boot-time audit: a real provider selected without its key
// must fail fast with the MISSING KEY NAMED — never a silent half-up service.
describe('assertDeployReady', () => {
  const base = { DATABASE_URL: 'postgres://tovira:tovira@localhost:5432/tovira' };
  const ready = (env: Record<string, string | undefined>) => () => assertDeployReady(loadConfig(env), env);

  it('passes for an all-stub local config (zero real providers → zero required keys)', () => {
    expect(ready(base)).not.toThrow();
  });

  it('MODEL_PROVIDER=anthropic without ANTHROPIC_API_KEY fails, naming the key', () => {
    const check = ready({ ...base, MODEL_PROVIDER: 'anthropic' });
    expect(check).toThrow(ConfigError);
    expect(check).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('TRANSCRIBER=groq without GROQ_API_KEY fails, naming the key', () => {
    expect(ready({ ...base, TRANSCRIBER: 'groq' })).toThrow(/GROQ_API_KEY/);
  });

  it('PUSH_SENDER=webpush without VAPID keys names BOTH', () => {
    const check = ready({ ...base, PUSH_SENDER: 'webpush' });
    expect(check).toThrow(/VAPID_PUBLIC_KEY/);
    expect(check).toThrow(/VAPID_PRIVATE_KEY/);
  });

  it('EMAIL_SENDER=ses names SES_REGION, a real EMAIL_FROM, and a public APP_BASE_URL', () => {
    const check = ready({ ...base, EMAIL_SENDER: 'ses' }); // defaults: *.local sender, localhost base
    expect(check).toThrow(/SES_REGION/);
    expect(check).toThrow(/EMAIL_FROM/);
    expect(check).toThrow(/APP_BASE_URL/);
  });

  it('EMAIL_SENDER=ses passes once the sender, region and base URL are real', () => {
    expect(
      ready({
        ...base,
        EMAIL_SENDER: 'ses',
        SES_REGION: 'me-central-1',
        EMAIL_FROM: 'Tovira <no-reply@tovira.app>',
        APP_BASE_URL: 'https://app.tovira.app',
      }),
    ).not.toThrow();
  });

  it('a real Stripe secret key with test-placeholder webhook/price IDs fails, naming each', () => {
    const check = ready({ ...base, STRIPE_SECRET_KEY: 'sk_live_real' });
    expect(check).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(check).toThrow(/STRIPE_PRICE_ID/);
    expect(check).toThrow(/STRIPE_ANNUAL_PRICE_ID/);
  });

  it('a fully-real Stripe config passes', () => {
    expect(
      ready({
        ...base,
        STRIPE_SECRET_KEY: 'sk_live_real',
        STRIPE_WEBHOOK_SECRET: 'whsec_live_real',
        STRIPE_PRICE_ID: 'price_live_monthly',
        STRIPE_ANNUAL_PRICE_ID: 'price_live_annual',
      }),
    ).not.toThrow();
  });

  it('collects EVERY offending key into one error (not just the first)', () => {
    const check = ready({ ...base, MODEL_PROVIDER: 'anthropic', TRANSCRIBER: 'groq', PUSH_SENDER: 'webpush' });
    expect(check).toThrow(/ANTHROPIC_API_KEY[\s\S]*GROQ_API_KEY[\s\S]*VAPID_PUBLIC_KEY/);
  });

  // [STAGING-EMBEDDER] a real AI provider with a STUB embedder is a half-real config
  // — recall/search silently return nothing. It must fail fast, naming EMBEDDER.
  it('MODEL_PROVIDER=anthropic with a STUB embedder fails, naming EMBEDDER', () => {
    const check = ready({ ...base, MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-real' }); // EMBEDDER defaults to stub
    expect(check).toThrow(ConfigError);
    expect(check).toThrow(/EMBEDDER/);
  });

  it('MODEL_PROVIDER=anthropic with a real (bedrock) embedder passes', () => {
    expect(ready({ ...base, MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-real', EMBEDDER: 'bedrock' })).not.toThrow();
  });
});

describe('EMBED_DIM (embedding dimension)', () => {
  const base = { DATABASE_URL: 'postgres://tovira:tovira@localhost:5432/tovira' };
  it('defaults to 512 (half the storage/index RAM of 1024 on a t4g.small)', () => {
    expect(loadConfig(base).embedDim).toBe(512);
  });
  it('accepts the Titan-v2 supported dimensions', () => {
    expect(loadConfig({ ...base, EMBED_DIM: '1024' }).embedDim).toBe(1024);
    expect(loadConfig({ ...base, EMBED_DIM: '256' }).embedDim).toBe(256);
  });
  it('rejects an unsupported dimension, naming EMBED_DIM', () => {
    expect(() => loadConfig({ ...base, EMBED_DIM: '768' })).toThrow(/EMBED_DIM/);
  });
});

describe('describeAdapters', () => {
  const base = { DATABASE_URL: 'postgres://tovira:tovira@localhost:5432/tovira' };
  it('reports all-stub for a local config', () => {
    expect(describeAdapters(loadConfig(base))).toEqual({ model: 'stub', embedder: 'stub', transcriber: 'stub', push: 'stub', email: 'stub' });
  });
  it('reports live for the providers that are real', () => {
    const modes = describeAdapters(loadConfig({ ...base, MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', EMBEDDER: 'bedrock', TRANSCRIBER: 'groq' }));
    expect(modes.model).toBe('live');
    expect(modes.embedder).toBe('live');
    expect(modes.transcriber).toBe('live');
    expect(modes.push).toBe('stub');
  });
});
