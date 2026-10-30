import { describe, it, expect } from 'vitest';
import { BillingService } from './billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../../adapters/billing/stub-stripe.js';

// [P61 · owner] Once an inbox has had a trial it never gets a second one, whoever the account came from (an invite or
// the public form). The same inbox: plus-tags and Gmail dots are folded, so wabil+test3@ is wabil@. (P61-1 had given
// invitees a fresh trial; reverted by the owner.)
const DAY = 86_400_000;
const SEPT = Date.parse('2026-09-22T09:00:00Z');
const NOW = Date.parse('2026-10-30T09:00:00Z');
const svc = () => new BillingService(new InMemorySubscriptionRepository(), new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 14);

describe('[P61] one trial per inbox, invitees included', () => {
  it('an account from an invite on an inbox that already had a trial inherits it (here: ended 6 Oct), never a second one', async () => {
    const b = svc();
    await b.onSignup('sept', 'wabil@prospera-technologies.com', SEPT);
    await b.onSignup('invited', 'wabil+test3@prospera-technologies.com', NOW);
    const e = await b.entitlement('invited', NOW);
    expect(e.trialEndsAt).toBe(SEPT + 14 * DAY);
    expect(e.entitled).toBe(false);
  });
  it('a never-used inbox gets the full 14 days from activation', async () => {
    const b = svc();
    await b.onSignup('fresh', 'sara@emaar.example', NOW);
    expect((await b.entitlement('fresh', NOW)).trialEndsAt).toBe(NOW + 14 * DAY);
  });
});
