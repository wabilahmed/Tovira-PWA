import { describe, it, expect } from 'vitest';
import { BillingService } from './billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../../adapters/billing/stub-stripe.js';

function billing() {
  const subs = new InMemorySubscriptionRepository();
  return { subs, svc: new BillingService(subs, new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 14) };
}

describe('[TRIAL-FARM] trial grant is keyed by the NORMALISED email (no fresh trial per alias)', () => {
  it('two signups from the same Gmail inbox (dots + plus + googlemail) reuse ONE grant', async () => {
    const { subs, svc } = billing();
    const t0 = Date.parse('2026-09-20T00:00:00Z');
    // First signup claims the trial.
    await svc.onSignup('user-a', 'wabil@gmail.com', t0);
    const endA = (await subs.get('user-a'))!.trialEndsAt;
    // A DAY later, aliases of the SAME inbox sign up — they must NOT get a fresh 14-day window.
    for (const [uid, email] of [['user-b', 'w.abil@gmail.com'], ['user-c', 'wabil+promo@gmail.com'], ['user-d', 'WA.BIL@googlemail.com']] as const) {
      await svc.onSignup(uid, email, t0 + 24 * 60 * 60 * 1000);
      expect((await subs.get(uid))!.trialEndsAt, `${email} must reuse the original grant`).toBe(endA);
    }
  });

  it('a genuinely different inbox gets its own trial', async () => {
    const { subs, svc } = billing();
    const t0 = Date.parse('2026-09-20T00:00:00Z');
    await svc.onSignup('user-a', 'wabil@gmail.com', t0);
    await svc.onSignup('user-x', 'someone.else@gmail.com', t0 + 24 * 60 * 60 * 1000);
    expect((await subs.get('user-x'))!.trialEndsAt).not.toBe((await subs.get('user-a'))!.trialEndsAt);
  });
});
