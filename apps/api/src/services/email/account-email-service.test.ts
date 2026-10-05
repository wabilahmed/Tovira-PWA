import { describe, it, expect } from 'vitest';
import { AccountEmailService } from './account-email-service.js';
import { StubEmailSender } from '../../adapters/email/stub-email-sender.js';
import { InMemoryEmailLogRepository } from '../../adapters/email/in-memory-email-log-repository.js';

function make() {
  const email = new StubEmailSender();
  const svc = new AccountEmailService(email, new InMemoryEmailLogRepository());
  return { email, svc };
}
const RENEW = Date.parse('2026-09-14T00:00:00Z');

describe('AccountEmailService', () => {
  it('sends a password reset with the link and no urgency language', async () => {
    const { email, svc } = make();
    await svc.sendPasswordReset('rep@example.com', 'https://app.tovira.com/reset?token=abc');
    const [m] = email.to('rep@example.com');
    expect(m!.subject).toMatch(/reset your tovira password/i);
    expect(m!.text).toContain('https://app.tovira.com/reset?token=abc');
    expect(m!.text).not.toMatch(/!|urgent|now|act fast/i);
  });

  it('confirms a subscription with the renewal date, or omits it when unknown (never invented)', async () => {
    const { email, svc } = make();
    await svc.sendSubscriptionConfirmed('u', 'a@x.com', 'evt1', RENEW);
    expect(email.to('a@x.com')[0]!.text).toMatch(/renews on 14 Sep 2026/);
    await svc.sendSubscriptionConfirmed('u2', 'b@x.com', 'evt2', null);
    expect(email.to('b@x.com')[0]!.text).not.toMatch(/renews/i);
  });

  it('states the trial end date in the trial-ending email', async () => {
    const { email, svc } = make();
    await svc.sendTrialEnding('u', 'a@x.com', RENEW);
    expect(email.to('a@x.com')[0]!.text).toMatch(/14 Sep 2026/);
    expect(email.to('a@x.com')[0]!.text).toMatch(/preserved/);
  });

  // Idempotency: one lifecycle email per (user, event) — a re-run never doubles.
  it('sends each lifecycle email at most once per user (idempotent)', async () => {
    const { email, svc } = make();
    expect(await svc.sendWelcome('u', 'a@x.com', RENEW)).toBe(true);
    expect(await svc.sendWelcome('u', 'a@x.com', RENEW)).toBe(false); // replay → not sent
    expect(email.to('a@x.com')).toHaveLength(1);
  });

  it('keys payment-failed by the webhook event so a replay never re-sends', async () => {
    const { email, svc } = make();
    const PAY = 'https://pay.stripe.test/in_1';
    await svc.sendPaymentFailed('u', 'a@x.com', 'invoice_evt_1', PAY);
    await svc.sendPaymentFailed('u', 'a@x.com', 'invoice_evt_1', PAY); // same event replayed
    expect(email.to('a@x.com')).toHaveLength(1);
    // D3/D4: the failed-payment email lists the paused features and links to the payment page.
    const sent = email.to('a@x.com')[0]!;
    expect(sent.text).toContain('pre-meeting briefs'); // a D3 paused feature
    expect(sent.text).toContain('export your data'); // everything else keeps working, incl. export
    expect(sent.text).toContain(PAY);
  });

  it('[BILLING-DUNNING · D4–D8] reminder/suspended/ended/deletion emails list features + pay link', async () => {
    const { email, svc } = make();
    const PAY = 'https://pay.stripe.test/in_1';
    await svc.sendPaymentReminder('u', 'a@x.com', '2026-10-06', PAY);
    await svc.sendSuspended('u', 'a@x.com', PAY);
    await svc.sendSubscriptionEnded('u', 'a@x.com');
    await svc.sendDeletionWarning('u', 'a@x.com', 30, 'https://app.test/account/export');
    const sent = email.to('a@x.com');
    expect(sent).toHaveLength(4);
    expect(sent[0]!.text).toContain(PAY);                       // reminder links to pay
    expect(sent[1]!.text.toLowerCase()).toContain('suspended'); // suspension
    expect(sent[2]!.text).toContain('hello@tovira.io');         // ended → contact to restore
    expect(sent[3]!.text).toContain('30 days');                 // deletion warning
    // The reminder is day-stamped: a different day sends again, the same day does not.
    await svc.sendPaymentReminder('u', 'a@x.com', '2026-10-06', PAY);
    expect(email.to('a@x.com')).toHaveLength(4); // same day → no resend
    await svc.sendPaymentReminder('u', 'a@x.com', '2026-10-07', PAY);
    expect(email.to('a@x.com')).toHaveLength(5); // next day → sends
  });
});
