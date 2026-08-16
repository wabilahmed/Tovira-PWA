import { describe, it, expect } from 'vitest';
import { loadConfig, assertDeployReady, ConfigError } from './config.js';

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
});
