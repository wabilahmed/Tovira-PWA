import { describe, it, expect } from 'vitest';
import { AccountEmailService } from './account-email-service.js';
import { appLinks } from './email-links.js';
import { InMemoryEmailLogRepository } from '../../adapters/email/in-memory-email-log-repository.js';
import type { EmailMessage } from '../../ports/email.js';
import type { AccessRequestRecord } from '../../ports/access-request-repository.js';

/**
 * [P22-4 / NOTIF-06 / NOTIF-07] Every link in every email is built from the CONFIGURED app URL, lands on a
 * page the app actually serves, and never names a domain we don't own or a raw CloudFront host. The one
 * deliberate exception: Stripe's hosted invoice page (3DS completion, billing ruling 2) in payment emails.
 */
const APP = 'https://app.example.test';
const links = appLinks(APP);
const STRIPE_INVOICE = 'https://invoice.stripe.com/i/acct_x/inv_y';
// Paths the web app serves (mirrors KNOWN_SPA_PATHS in apps/web/src/App.tsx) + the API prefix.
const SERVED = ['/', '/app', '/reset-password', '/invite', '/verify-email', '/request-access', '/billing'];
const FOREIGN = new RegExp(['tovira', 'com'].join('\\.') + '|cloudfront\\.net', 'i');

function capture(): { svc: AccountEmailService; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { svc: new AccountEmailService({ send: async (m) => { sent.push(m); } }, new InMemoryEmailLogRepository(), APP), sent };
}
const urlsIn = (m: EmailMessage): string[] =>
  [...new Set([...(m.text.match(/https?:\/\/[^\s"'<>)]+/g) ?? []), ...((m.html ?? '').match(/https?:\/\/[^\s"'<>)]+/g) ?? [])].map((u) => u.replace(/&amp;/g, '&')))];

const request = { id: 'req1', fullName: 'A', workEmail: 'a@b.test', phone: '1', companyName: 'C', roleTitle: 'R', ownership: 'owns_or_manages', conversationOwnership: 'own_clients', expectedVolume: 'under_50' } as unknown as AccessRequestRecord;

/** Every template, sent the way index.ts / the routes send it. */
const TEMPLATES: Array<[string, (s: AccountEmailService) => Promise<unknown>]> = [
  ['password reset', (s) => s.sendPasswordReset('r@x.test', links.resetPassword('tok'))],
  ['invite', (s) => s.sendInvite('r@x.test', links.invite('tok'))],
  ['verify email (resend)', (s) => s.sendVerification('r@x.test', links.verifyEmail('tok'))],
  ['welcome + verify', (s) => s.sendWelcome('u1', 'r@x.test', Date.parse('2026-11-01'), links.verifyEmail('tok'))],
  ['welcome, already verified', (s) => s.sendWelcome('u2', 'r@x.test', Date.parse('2026-11-01'))],
  ['trial ending', (s) => s.sendTrialEnding('u1', 'r@x.test', Date.parse('2026-11-01'))],
  ['trial ended', (s) => s.sendTrialEnded('u1', 'r@x.test')],
  ['subscription active', (s) => s.sendSubscriptionConfirmed('u1', 'r@x.test', 'evt1', Date.parse('2026-11-14'))],
  ['subscription canceled', (s) => s.sendSubscriptionCanceled('u1', 'r@x.test', 'evt2')],
  ['payment failed (hosted invoice)', (s) => s.sendPaymentFailed('u1', 'r@x.test', 'evt3', STRIPE_INVOICE)],
  ['payment failed (no invoice yet)', (s) => s.sendPaymentFailed('u3', 'r@x.test', 'evt3', links.billing)],
  ['payment reminder', (s) => s.sendPaymentReminder('u1', 'r@x.test', '2026-10-18', STRIPE_INVOICE)],
  ['suspended', (s) => s.sendSuspended('u1', 'r@x.test', STRIPE_INVOICE)],
  ['subscription ended', (s) => s.sendSubscriptionEnded('u1', 'r@x.test')],
  ['deletion warning (30d)', (s) => s.sendDeletionWarning('u1', 'r@x.test', 30, links.export)],
  ['deletion warning (7d)', (s) => s.sendDeletionWarning('u1', 'r@x.test', 7, links.export)],
  ['account deleted', (s) => s.sendAccountDeleted('u1', 'r@x.test')],
  ['access request (owner)', (s) => s.sendAccessRequestNotification('owner@x.test', request, links.opsApprove('req1'))],
];

describe('[P22-4] email links', () => {
  for (const [name, send] of TEMPLATES) {
    it(`${name}: every link is on the app origin and lands on a served page`, async () => {
      const { svc, sent } = capture();
      await send(svc);
      expect(sent, 'the email was sent').toHaveLength(1);
      for (const u of urlsIn(sent[0]!)) {
        expect(u, `${name}: foreign host`).not.toMatch(FOREIGN);
        if (u.startsWith('https://invoice.stripe.com/')) { expect(name, 'Stripe page only in payment emails').toMatch(/payment|suspended/); continue; }
        const url = new URL(u);
        expect(url.origin, `${name}: ${u}`).toBe(APP);
        const ok = url.pathname.startsWith('/api/') || SERVED.includes(url.pathname);
        expect(ok, `${name}: ${u} is not a page the app serves`).toBe(true);
      }
    });
  }

  // "Your subscription is active" had no link at all. Billing emails carry Open Tovira + Manage billing.
  for (const name of ['subscription active', 'subscription canceled', 'trial ending', 'trial ended', 'subscription ended']) {
    it(`${name}: has Open Tovira and Manage billing buttons`, async () => {
      const { svc, sent } = capture();
      await TEMPLATES.find(([n]) => n === name)![1](svc);
      const m = sent[0]!;
      expect(m.html).toContain(`href="${links.open}"`);
      expect(m.html).toContain('>Open Tovira<');
      expect(m.html).toContain(`href="${links.billing.replace(/&/g, '&amp;')}"`);
      expect(m.html).toContain('>Manage billing<');
      expect(m.text).toContain(links.open);
      expect(m.text).toContain(links.billing);
    });
  }

  it('payment emails keep "Update payment details" and add Open Tovira', async () => {
    const { svc, sent } = capture();
    await svc.sendPaymentFailed('u1', 'r@x.test', 'evt9', STRIPE_INVOICE);
    expect(sent[0]!.html).toContain('>Update payment details<');
    expect(sent[0]!.html).toContain(`href="${links.open}"`);
  });

  it('appLinks builds only from the configured URL (trailing slash tolerated) and points at served pages', () => {
    const l = appLinks('https://staging.tovira.io/');
    expect(l.open).toBe('https://staging.tovira.io/app');
    expect(l.billing).toBe('https://staging.tovira.io/app?view=settings'); // Settings → Billing, not the 404 /settings
    expect(l.export).toBe('https://staging.tovira.io/app?view=settings');  // the export button lives in Settings
    expect(l.opsApprove('r1')).toBe('https://staging.tovira.io/api/ops/access-requests/r1/approve'); // via the API prefix
  });
});
