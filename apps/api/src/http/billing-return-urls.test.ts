import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';

// [BILL-13] Every Stripe return URL the server configures must resolve to a real app route — otherwise a
// rep who just paid lands on a 404. These are the known SPA routes that App.tsx serves (kept in sync with
// KNOWN_SPA_PATHS / BILLING_RETURN_PATHS in apps/web/src/App.tsx). This test fails if a configured return
// URL points anywhere else.
const KNOWN_RETURN_PATHS = new Set(['/billing/success', '/billing/cancel', '/billing']);

describe('[BILL-13] configured Stripe return URLs are real app routes', () => {
  const BASE_ENV = { DATABASE_URL: 'postgres://u:p@localhost:5432/t', APP_BASE_URL: 'https://staging.tovira.io' } as NodeJS.ProcessEnv;
  const cfg = loadConfig(BASE_ENV);

  it('the checkout success + cancel URLs resolve to known routes', () => {
    for (const url of [cfg.stripeSuccessUrl, cfg.stripeCancelUrl]) {
      expect(KNOWN_RETURN_PATHS.has(new URL(url).pathname)).toBe(true);
    }
    expect(new URL(cfg.stripeSuccessUrl).pathname).toBe('/billing/success');
    expect(new URL(cfg.stripeCancelUrl).pathname).toBe('/billing/cancel');
  });

  it('the Customer Portal return path (/billing) is a known route', () => {
    // billing-routes builds `${appBaseUrl}/billing` for the portal return_url.
    expect(KNOWN_RETURN_PATHS.has('/billing')).toBe(true);
  });

  it('honours explicit STRIPE_SUCCESS_URL/CANCEL_URL overrides when they are set', () => {
    const over = loadConfig({ ...BASE_ENV, STRIPE_SUCCESS_URL: 'https://x.io/billing/success', STRIPE_CANCEL_URL: 'https://x.io/billing/cancel' } as NodeJS.ProcessEnv);
    expect(new URL(over.stripeSuccessUrl).pathname).toBe('/billing/success');
    expect(new URL(over.stripeCancelUrl).pathname).toBe('/billing/cancel');
  });
});

// [P30] APP_BASE_URL becomes https://tovira.io at the move. A trailing slash in the secret must not produce
// "//invite" / "//billing/success" links — invite, reset, verify and Stripe return URLs append a path to it.
describe('[P30] APP_BASE_URL trailing slash', () => {
  it('is trimmed, so every link built from it has exactly one slash', async () => {
    const { loadConfig } = await import('../config.js');
    const cfg = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/t', APP_BASE_URL: 'https://tovira.io/' } as NodeJS.ProcessEnv);
    expect(cfg.appBaseUrl).toBe('https://tovira.io');
    expect(`${cfg.appBaseUrl}/invite?token=x`).toBe('https://tovira.io/invite?token=x');
    expect(cfg.stripeSuccessUrl).toBe('https://tovira.io/billing/success');
  });
});
