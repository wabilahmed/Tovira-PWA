import { describe, it, expect } from 'vitest';
import { billingGateDecision, isAiPath, aiPausedForState } from './billing-access.js';
import { dunningAction, retentionAction, SUSPEND_AFTER_DAYS, END_AFTER_DAYS, RETENTION_AFTER_END_DAYS } from './billing-dunning.js';
import { BillingDunningService } from './billing-dunning-service.js';
import { InMemorySubscriptionRepository } from '../../adapters/billing/in-memory.js';
import { StubStripeGateway } from '../../adapters/billing/stub-stripe.js';
import type { SubscriptionRecord } from '../../ports/billing.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-07-09T14:00:00Z');

// The AI (model-calling) paths that are paused in payment_failed, and some NON-AI paths that must stay open.
const AI = [
  ['POST', '/clients/c1/notes/import'], ['POST', '/import/bulk'], ['POST', '/notes/n1/extract'],
  ['POST', '/notes/n1/transcribe'], ['POST', '/recall'], ['GET', '/clients/c1/brief'],
  ['POST', '/notes/n1/follow-up'], ['GET', '/today'], ['POST', '/today/refresh'], ['GET', '/inventory/matches'],
] as const;
const NON_AI = [
  ['GET', '/clients'], ['GET', '/clients/c1'], ['GET', '/book-scan'], ['GET', '/monday-digest'],
  ['GET', '/hero/patterns'], ['GET', '/clients/c1/notes'], ['GET', '/account/export'],
] as const;

describe('[BILLING-DUNNING · guard 1] payment_failed pauses exactly the AI paths, nothing else', () => {
  it('every AI path is ai_paused', () => {
    for (const [m, p] of AI) expect(billingGateDecision('payment_failed', m, p)).toBe('ai_paused');
  });
  it('every non-AI path (incl. Book Scan, Monday, export) is allowed', () => {
    for (const [m, p] of NON_AI) expect(billingGateDecision('payment_failed', m, p)).toBe('allow');
  });
  it('active allows everything', () => {
    for (const [m, p] of [...AI, ...NON_AI]) expect(billingGateDecision('active', m, p)).toBe('allow');
  });
  it('isAiPath agrees (Book Scan is NOT an AI path — ruling 3)', () => {
    expect(isAiPath('GET', '/book-scan')).toBe(false);
    expect(isAiPath('POST', '/recall')).toBe(true);
  });
});

describe('[BILLING-DUNNING · guard 2] suspended/ended allow only payment, export, auth — export in EVERY state', () => {
  for (const state of ['suspended', 'ended'] as const) {
    it(`${state}: blocks AI + ordinary viewing, allows export + billing + auth`, () => {
      for (const [m, p] of AI) expect(billingGateDecision(state, m, p)).toBe('blocked_suspended');
      expect(billingGateDecision(state, 'GET', '/clients')).toBe('blocked_suspended');
      expect(billingGateDecision(state, 'GET', '/account/export')).toBe('allow'); // data export — always
      expect(billingGateDecision(state, 'POST', '/billing/checkout')).toBe('allow');
      expect(billingGateDecision(state, 'POST', '/auth/logout')).toBe('allow');
    });
  }
  it('export is allowed in every billing state', () => {
    for (const state of ['active', 'payment_failed', 'suspended', 'ended'] as const) {
      expect(billingGateDecision(state, 'GET', '/account/export')).toBe('allow');
    }
  });
});

const sub = (over: Partial<SubscriptionRecord>): SubscriptionRecord => ({
  userId: 'u', status: 'active', billingState: 'payment_failed', firstFailedAt: T0, lastRetryAt: null,
  openInvoiceId: 'in_1', hostedInvoiceUrl: null, hardDeclineCount: 0, authRequiredCount: 0,
  deletionWarned30d: false, deletionWarned7d: false, endedAt: null, trialEndsAt: 0,
  stripeCustomerId: 'cus_1', stripeSubscriptionId: null, currentPeriodEnd: null, currentPeriodStart: null,
  billingName: null, billingCompany: null, ...over,
});

describe('[BILLING-DUNNING · guard 5] daily action: once/day, suspend@7, end@30, never active', () => {
  it('an active or ended account never retries', () => {
    expect(dunningAction(sub({ billingState: 'active' }), T0 + 3 * DAY).retry).toBe(false);
    expect(dunningAction(sub({ billingState: 'ended', endedAt: T0 }), T0 + 3 * DAY).retry).toBe(false);
  });
  it('day 3: retries + reminds once; a second run the same day does neither', () => {
    expect(dunningAction(sub({ lastRetryAt: null }), T0 + 3 * DAY)).toMatchObject({ retry: true, remind: true });
    expect(dunningAction(sub({ lastRetryAt: T0 + 3 * DAY }), T0 + 3 * DAY)).toMatchObject({ retry: false, remind: false });
  });
  // Day boundaries pinned as LITERALS (not the constants) so a change to SUSPEND_AFTER_DAYS/END_AFTER_DAYS
  // is caught (a test that reads the same constant it guards would move with it and prove nothing).
  it('the suspend boundary is day 7', () => {
    expect(SUSPEND_AFTER_DAYS).toBe(7);
    expect(dunningAction(sub({ lastRetryAt: null }), T0 + 6 * DAY).nextState).toBeUndefined(); // day 6: not yet
    const a = dunningAction(sub({ lastRetryAt: null }), T0 + 7 * DAY);
    expect(a.nextState).toBe('suspended'); // day 7: suspend
    expect(a.retry).toBe(true); // still retrying through day 30
  });
  it('the end boundary is day 30', () => {
    expect(END_AFTER_DAYS).toBe(30);
    expect(dunningAction(sub({ billingState: 'suspended', lastRetryAt: null }), T0 + 29 * DAY).nextState).toBeUndefined(); // day 29: still trying
    const a = dunningAction(sub({ billingState: 'suspended', lastRetryAt: null }), T0 + 30 * DAY);
    expect(a.nextState).toBe('ended'); // day 30: end
    expect(a.retry).toBe(false); // stop retrying
  });
});

describe('[BILLING-DUNNING · guard 5] the daily job over the store', () => {
  function make(now: number) {
    const subs = new InMemorySubscriptionRepository();
    const stripe = new StubStripeGateway();
    const svc = new BillingDunningService({ subs, stripe, now: () => now });
    return { subs, stripe, svc };
  }
  it('retries the open invoice once and stamps lastRetryAt; never touches an active account', async () => {
    const { subs, stripe, svc } = make(T0 + 3 * DAY);
    await subs.create('u', 0); await subs.update('u', { billingState: 'payment_failed', firstFailedAt: T0, openInvoiceId: 'in_1', stripeCustomerId: 'cus_1' });
    await subs.create('v', 0); // v stays active
    stripe.payInvoiceOutcome = () => 'failed';
    const r = await svc.run();
    expect(stripe.invoicePays).toEqual(['in_1']); // only the failing account retried
    expect(r.retried).toBe(1);
    expect((await subs.get('u'))!.lastRetryAt).toBe(T0 + 3 * DAY);
  });
  it('day 30: ends without retrying', async () => {
    const { subs, stripe, svc } = make(T0 + 30 * DAY); // literal: day-30 end boundary
    await subs.create('u', 0); await subs.update('u', { billingState: 'payment_failed', firstFailedAt: T0, openInvoiceId: 'in_1', stripeCustomerId: 'cus_1' });
    await svc.run();
    expect(stripe.invoicePays).toEqual([]); // no retry at day 30
    expect((await subs.get('u'))!.billingState).toBe('ended');
    expect((await subs.get('u'))!.endedAt).toBe(T0 + 30 * DAY);
  });
});

describe('[BILLING-DUNNING · D8] retention action', () => {
  it('warns at 60d and 7-left, deletes at 90d', () => {
    const ended = (days: number, over: Partial<SubscriptionRecord> = {}) => sub({ billingState: 'ended', endedAt: T0, ...over });
    expect(retentionAction(ended(0), T0 + (RETENTION_AFTER_END_DAYS - 30) * DAY)).toMatchObject({ warn30d: true, delete: false });
    expect(retentionAction(ended(0), T0 + (RETENTION_AFTER_END_DAYS - 7) * DAY)).toMatchObject({ warn7d: true, delete: false });
    expect(retentionAction(ended(0), T0 + RETENTION_AFTER_END_DAYS * DAY).delete).toBe(true);
    // a rep restored during the window (back to active) is never deleted
    expect(retentionAction(sub({ billingState: 'active', endedAt: null }), T0 + 365 * DAY).delete).toBe(false);
  });
});

describe('[BILLING-DUNNING] aiPausedForState', () => {
  it('pauses the async sweep in every non-active state, resumes on active', () => {
    expect(aiPausedForState('active')).toBe(false);
    for (const s of ['payment_failed', 'suspended', 'ended'] as const) expect(aiPausedForState(s)).toBe(true);
  });
});
