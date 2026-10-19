import { describe, it, expect } from 'vitest';
import { AccountEmailService } from './account-email-service.js';
import { StubEmailSender } from '../../adapters/email/stub-email-sender.js';
import { InMemoryEmailLogRepository } from '../../adapters/email/in-memory-email-log-repository.js';
import type { AccessRequestRecord } from '../../ports/access-request-repository.js';

/**
 * [P32] Prospera Technologies FZ-LLC is NOT VAT-registered: no email may say a price includes VAT, or mention
 * VAT / TRN at all. Renders EVERY template on AccountEmailService (a new `send…` method that isn't listed here
 * fails the coverage check) and checks subject + text + html for: "VAT", "incl." next to a price, "inclusive",
 * "TRN", or the Arabic VAT words. (There is no top-up receipt email — Stripe sends its own receipt — and the
 * Monday statement is in-app, not an email.)
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['VAT', /\bVAT\b/i],
  ['incl. next to a price', /AED\s*[\d,.]+[^.\n]{0,24}\bincl\b|\bincl\b[^.\n]{0,24}AED\s*[\d,.]+/i],
  ['inclusive', /inclusive/i],
  ['TRN', /\bTRN\b/],
  ['Arabic VAT words', /ضريبة|القيمة المضافة/],
];
const offences = (text: string) => FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => name);

const T = Date.parse('2026-11-01T00:00:00Z');
const REQUEST = {
  id: 'r1', fullName: 'Sara Khan', workEmail: 'sara@example.com', phone: '+971500000000', companyName: 'Khan Realty', roleTitle: 'Broker',
  ownership: 'employed', tradeLicenceNumber: null, conversationOwnership: 'mine', conversationOwnershipOther: null, expectedVolume: 'low',
} as unknown as AccessRequestRecord;

// Every template, with representative arguments.
const CALLS: Record<string, (s: AccountEmailService) => Promise<unknown>> = {
  sendPasswordReset: (s) => s.sendPasswordReset('a@x.com', 'https://tovira.io/reset-password?token=t'),
  sendAccessRequestNotification: (s) => s.sendAccessRequestNotification('ops@x.com', REQUEST, 'https://tovira.io/api/ops/access-requests/r1/approve'),
  sendInvite: (s) => s.sendInvite('a@x.com', 'https://tovira.io/invite?token=t'),
  sendWelcome: (s) => s.sendWelcome('u1', 'a@x.com', T, 'https://tovira.io/verify-email?token=t'),
  sendVerification: (s) => s.sendVerification('a@x.com', 'https://tovira.io/verify-email?token=t'),
  sendTrialEnding: (s) => s.sendTrialEnding('u2', 'a@x.com', T),
  sendTrialEnded: (s) => s.sendTrialEnded('u3', 'a@x.com'),
  sendPaymentFailed: (s) => s.sendPaymentFailed('u4', 'a@x.com', 'evt', 'https://invoice.stripe.com/i/x'),
  sendPaymentReminder: (s) => s.sendPaymentReminder('u5', 'a@x.com', '2026-11-02', 'https://invoice.stripe.com/i/x'),
  sendSuspended: (s) => s.sendSuspended('u6', 'a@x.com', 'https://invoice.stripe.com/i/x'),
  sendSubscriptionEnded: (s) => s.sendSubscriptionEnded('u7', 'a@x.com'),
  sendDeletionWarning: (s) => s.sendDeletionWarning('u8', 'a@x.com', 7, 'https://tovira.io/app?view=settings'),
  sendSubscriptionConfirmed: (s) => s.sendSubscriptionConfirmed('u9', 'a@x.com', 'evt', T),
  sendSubscriptionCanceled: (s) => s.sendSubscriptionCanceled('u10', 'a@x.com', 'evt'),
  sendAccountDeleted: (s) => s.sendAccountDeleted('u11', 'a@x.com'),
};

describe('[P32] no VAT wording in any email', () => {
  it('covers every template on AccountEmailService', () => {
    const methods = Object.getOwnPropertyNames(AccountEmailService.prototype).filter((n) => n.startsWith('send')).sort();
    expect(methods).toEqual(Object.keys(CALLS).sort());
  });

  for (const [name, call] of Object.entries(CALLS)) {
    it(`${name} — subject, text and html carry no VAT wording`, async () => {
      const email = new StubEmailSender();
      await call(new AccountEmailService(email, new InMemoryEmailLogRepository(), 'https://tovira.io'));
      expect(email.sent.length, `${name} sent nothing`).toBeGreaterThan(0);
      for (const m of email.sent) expect(offences(`${m.subject}\n${m.text}\n${m.html ?? ''}`), name).toEqual([]);
    });
  }
});
