import { describe, it, expect } from 'vitest';
import { BillingService } from './billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../../adapters/billing/stub-stripe.js';

// [P61-1 · owner] Everyone the founder invites or approves gets a fresh 14 days from the day they activate, as the emails
// promise. One trial per inbox (plus-tags and Gmail dots folded) still holds for self-serve signup, the real abuse path.
const DAY = 86_400_000;
const SEPT = Date.parse('2026-09-22T09:00:00Z');
const NOW = Date.parse('2026-10-30T09:00:00Z');
function billing() {
  const subs = new InMemorySubscriptionRepository();
  return { subs, svc: new BillingService(subs, new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 14) };
}

describe('[P61-1] the trial for an invited person', () => {
  it('a fresh 14 days from activation, even when the same inbox had a trial before', async () => {
    const { svc } = billing();
    await svc.onSignup('old', 'wabil@prospera-technologies.com', SEPT); // the September test account
    await svc.onSignup('new', 'wabil+test3@prospera-technologies.com', NOW, { invited: true });
    expect((await svc.entitlement('new', NOW)).trialEndsAt).toBe(NOW + 14 * DAY);
    expect((await svc.entitlement('new', NOW)).entitled).toBe(true);
  });
  it('NEGATIVE: a self-serve signup on an inbox that had a trial still inherits it (no farming)', async () => {
    const { svc } = billing();
    await svc.onSignup('old', 'wabil@prospera-technologies.com', SEPT);
    await svc.onSignup('again', 'wabil+test3@prospera-technologies.com', NOW);
    expect((await svc.entitlement('again', NOW)).trialEndsAt).toBe(SEPT + 14 * DAY);
  });
  it('an invited person\'s activation still records the inbox, so a later self-serve signup on it can\'t start a new trial', async () => {
    const { svc } = billing();
    await svc.onSignup('inv', 'sara@emaar.example', NOW, { invited: true });
    await svc.onSignup('self', 'sara+2@emaar.example', NOW + 20 * DAY);
    expect((await svc.entitlement('self', NOW + 20 * DAY)).trialEndsAt).toBe(NOW + 14 * DAY);
  });
});
