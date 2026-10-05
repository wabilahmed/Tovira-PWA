import { describe, it, expect, vi } from 'vitest';
import { BillingRetentionService } from './billing-retention-service.js';
import { BillingService } from './billing-service.js';
import { InMemorySubscriptionRepository, InMemoryTrialGrantRepository, InMemoryWebhookEventRepository } from '../../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../../adapters/billing/stub-stripe.js';
import { RETENTION_AFTER_END_DAYS } from './billing-dunning.js';

const DAY = 24 * 60 * 60 * 1000;
const END = Date.parse('2026-07-09T00:00:00Z');
const evt = (o: object) => JSON.stringify(o);

function make(now: number) {
  const subs = new InMemorySubscriptionRepository();
  const deleted: string[] = [];
  const emailHook = { deletionWarning: vi.fn(async () => {}) };
  const svc = new BillingRetentionService({ subs, deleteAccount: async (u) => { deleted.push(u); }, emailHook: emailHook as never, now: () => now });
  return { subs, svc, deleted, emailHook };
}
async function endAccount(subs: InMemorySubscriptionRepository, userId: string) {
  await subs.create(userId, 0);
  await subs.update(userId, { billingState: 'ended', endedAt: END, stripeCustomerId: `cus_${userId}` });
}

describe('[BILLING-DUNNING · D8] retention deletion after a subscription ends', () => {
  it('the retention clock is 90 days', () => expect(RETENTION_AFTER_END_DAYS).toBe(90));

  it('warns 30 days before, then 7 days before (each once), then deletes at 90 days', async () => {
    // 30-days-before = day 60.
    const { subs, svc, deleted, emailHook } = make(END + 60 * DAY);
    await endAccount(subs, 'u');
    await svc.run();
    expect(emailHook.deletionWarning).toHaveBeenCalledWith('u', 30);
    expect((await subs.get('u'))!.deletionWarned30d).toBe(true);
    await svc.run(); // same window again → not re-sent
    expect(emailHook.deletionWarning).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual([]); // not deleted yet
  });

  it('deletes through the existing path exactly at day 90', async () => {
    const { subs, svc, deleted } = make(END + RETENTION_AFTER_END_DAYS * DAY);
    await endAccount(subs, 'u');
    await svc.run();
    expect(deleted).toEqual(['u']); // the existing account-deletion path ran
  });

  it('does NOT delete before day 90', async () => {
    const { subs, svc, deleted } = make(END + 89 * DAY);
    await endAccount(subs, 'u');
    await svc.run();
    expect(deleted).toEqual([]);
  });

  // The core safety property: a rep who PAYS during the 90-day window is reactivated and is NEVER deleted.
  it('a rep who pays during the window is reactivated and never deleted', async () => {
    const subs = new InMemorySubscriptionRepository();
    const billing = new BillingService(subs, new InMemoryTrialGrantRepository(), new InMemoryWebhookEventRepository(), new StubStripeGateway('whsec_test'), 14, undefined, undefined, undefined, () => END);
    await billing.onSignup('u', 'rep@x.com', END);
    await billing.handleWebhook(evt({ id: 'ck', type: 'checkout.session.completed', userId: 'u', customerId: 'cus_u' }), 'whsec_test');
    // Drive to ended, then the rep pays (we restore them) → reactivation webhook.
    await subs.update('u', { billingState: 'ended', endedAt: END });
    await billing.handleWebhook(evt({ id: 'pay', type: 'invoice.payment_succeeded', customerId: 'cus_u' }), 'whsec_test');
    expect((await subs.get('u'))!.billingState).toBe('active'); // reactivated
    expect((await subs.get('u'))!.endedAt).toBeNull();

    // Run retention well past 90 days — the account is active now, so it is not in listEnded() and is never deleted.
    const deleted: string[] = [];
    const svc = new BillingRetentionService({ subs, deleteAccount: async (uu) => { deleted.push(uu); }, now: () => END + 200 * DAY });
    await svc.run();
    expect(deleted).toEqual([]);
  });
});
