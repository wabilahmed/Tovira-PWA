import type { EmailSender } from '../../ports/email.js';
import type { EmailLogRepository } from '../../ports/email-log-repository.js';
import type { AccessRequestRecord } from '../../ports/access-request-repository.js';
import { INVITE_TTL_DAYS } from '../access/access-approval-service.js';
import { renderEmail, type EmailContent } from './templates.js';
import { pausedFeaturesSentence } from '../billing/billing-access.js';

/** Human-readable labels for the stored enum codes, for the owner-facing notification email. */
const OWNERSHIP_LABEL: Record<string, string> = {
  owns_or_manages: 'Owns or manages the company',
  employed: 'Employed by the company',
};
const CONVO_LABEL: Record<string, string> = {
  own_clients: 'My own clients (holds the relationship directly)',
  brokerage_i_manage: 'Clients of the brokerage they own or manage',
  brokerage_employs_me: 'Clients of the brokerage that employs them',
  mix: 'A mix of the above',
  other: 'Other (see note)',
};
const VOLUME_LABEL: Record<string, string> = {
  under_50: 'Under 50', '50_200': '50–200', '200_500': '200–500', '500_plus': '500+',
};

/** Format an epoch-ms date as "14 Sep 2026" for email bodies (UTC, stable). */
function stampDate(ms: number): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const SIGNOFF = '\n\n— Tovira';

/**
 * Transactional + lifecycle email (TASK EMAIL). Composes every account email in
 * the brand voice (docs/tovira-brand.md §7/§10: measured, no exclamation marks,
 * no urgency, errors say what happened + what to do) and wraps it in the branded
 * Ledger HTML (templates.ts). Plain-text is the source of truth; the HTML mirrors
 * it. Lifecycle sends are idempotent: one per (user, event).
 */
export class AccountEmailService {
  constructor(
    private readonly email: EmailSender,
    private readonly log: EmailLogRepository,
  ) {}

  /** Password reset — NOT idempotency-logged; each request sends a fresh link. */
  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.email.send({
      to,
      subject: 'Reset your Tovira password',
      text:
        `Someone asked to reset the password for this Tovira account.\n\n` +
        `To set a new password, open this link within the next hour:\n${resetUrl}\n\n` +
        `If this wasn't you, no action is needed — your password stays the same and the link will expire.` +
        SIGNOFF,
      html: renderEmail({
        heading: 'Reset your password',
        intro: ['Someone asked to reset the password for this Tovira account.', 'To set a new password, open the link below within the next hour.'],
        button: { label: 'Reset password', url: resetUrl },
        outro: ["If this wasn't you, no action is needed — your password stays the same and the link will expire."],
      }),
    });
  }

  /**
   * [BETA-3] Notify the owner of a new beta access request. Carries the FULL submitted content (so the
   * owner can triage from a phone) plus the request id and a ready-to-paste curl to APPROVE that specific
   * request. The ops token is NOT in the email — it is left as the placeholder <OPS_TOKEN> for the owner
   * to fill. NOT idempotency-logged (no userId yet; one email per submission).
   */
  async sendAccessRequestNotification(to: string, r: AccessRequestRecord, approveUrl: string): Promise<void> {
    const lines = [
      `New beta access request (${r.id}).`,
      '',
      `Name:        ${r.fullName}`,
      `Work email:  ${r.workEmail}`,
      `Phone:       ${r.phone}`,
      `Company:     ${r.companyName}`,
      `Role:        ${r.roleTitle}`,
      `Ownership:   ${OWNERSHIP_LABEL[r.ownership] ?? r.ownership}`,
      ...(r.tradeLicenceNumber ? [`Trade licence: ${r.tradeLicenceNumber}`] : []),
      `Conversations to upload: ${CONVO_LABEL[r.conversationOwnership] ?? r.conversationOwnership}`,
      ...(r.conversationOwnershipOther ? [`  Note: ${r.conversationOwnershipOther}`] : []),
      `Expected volume: ${VOLUME_LABEL[r.expectedVolume] ?? r.expectedVolume}`,
      '',
      ...(r.ownership === 'employed' ? ['This applicant is EMPLOYED — ask for the company NOC by email before approving.', ''] : []),
      'To approve this request (fill in your ops token):',
      '',
      `curl -X POST '${approveUrl}' \\`,
      `  -H 'x-ops-token: <OPS_TOKEN>' \\`,
      `  -H 'content-type: application/json' \\`,
      `  -d '{"note":""}'`,
    ];
    await this.email.send({
      to,
      subject: `Beta access request — ${r.fullName} (${r.companyName})`,
      text: lines.join('\n') + SIGNOFF,
    });
  }

  /** [BETA-5] The invite to set a password + accept the terms. Carries the one-time link (raw token in
   *  the URL). NOT idempotency-logged — the operator can re-approve to resend a fresh link. */
  async sendInvite(to: string, inviteUrl: string): Promise<void> {
    await this.email.send({
      to,
      subject: 'Your Tovira invitation',
      text:
        `Your request for Tovira beta access has been approved.\n\n` +
        `To finish setting up your account, open this link and choose a password:\n${inviteUrl}\n\n` +
        `You will also be asked to accept the Terms and Privacy Policy. The link is single-use and expires in ${INVITE_TTL_DAYS} days.` +
        SIGNOFF,
      html: renderEmail({
        heading: 'Set up your Tovira account',
        intro: ['Your request for Tovira beta access has been approved.', 'Open the link below to choose a password and accept the Terms and Privacy Policy.'],
        button: { label: 'Set up my account', url: inviteUrl },
        outro: [`The link is single-use and expires in ${INVITE_TTL_DAYS} days.`],
      }),
    });
  }

  /** Send a lifecycle email once. Returns true if it was sent (false = already sent). */
  private async once(userId: string, eventKey: string, to: string, subject: string, text: string, content: EmailContent): Promise<boolean> {
    if (!(await this.log.recordIfAbsent(userId, eventKey))) return false;
    await this.email.send({ to, subject, text: text + SIGNOFF, html: renderEmail(content) });
    return true;
  }

  async sendWelcome(userId: string, to: string, trialEndsAt: number, verifyUrl?: string): Promise<boolean> {
    const confirm = verifyUrl
      ? `\n\nWhen you have a moment, confirm your email so we can reach you about your trial:\n${verifyUrl}`
      : '';
    return this.once(userId, 'welcome', to, 'Welcome to Tovira',
      `Your Tovira trial has started. It runs until ${stampDate(trialEndsAt)}.\n\n` +
      `Export one WhatsApp chat to see what your book has been hiding — that is the whole setup.` +
      confirm, {
        heading: 'Welcome to Tovira',
        intro: [`Your Tovira trial has started. It runs until ${stampDate(trialEndsAt)}.`, 'Export one WhatsApp chat to see what your book has been hiding — that is the whole setup.'],
        ...(verifyUrl ? { button: { label: 'Confirm your email', url: verifyUrl }, outro: ['Confirming your email lets us reach you about your trial.'] } : {}),
      });
  }

  /** Re-send just the email-confirmation link (EMAIL-VERIFY resend). Not
   *  idempotency-logged: a resend is a deliberate repeat, rate-limited upstream. */
  async sendVerification(to: string, verifyUrl: string): Promise<void> {
    await this.email.send({
      to,
      subject: 'Confirm your email for Tovira',
      text:
        `Confirm your email so we can reach you about your trial and account.\n\n` +
        `Open this link within the next seven days:\n${verifyUrl}\n\n` +
        `If you did not create a Tovira account, you can ignore this message.` +
        SIGNOFF,
      html: renderEmail({
        heading: 'Confirm your email',
        intro: ['Confirm your email so we can reach you about your trial and account.', 'Open the link below within the next seven days.'],
        button: { label: 'Confirm email', url: verifyUrl },
        outro: ['If you did not create a Tovira account, you can ignore this message.'],
      }),
    });
  }

  /** The conversion moment: two days before the trial ends. */
  async sendTrialEnding(userId: string, to: string, trialEndsAt: number): Promise<boolean> {
    return this.once(userId, 'trial_ending', to, 'Your Tovira trial ends in two days',
      `Your Tovira trial ends on ${stampDate(trialEndsAt)}.\n\n` +
      `When it ends, your captured notes and everything Tovira has filed are preserved — nothing is lost. ` +
      `To keep using briefs, recall and the Monday statement, subscribe from Settings before then.`, {
        heading: 'Your trial ends in two days',
        intro: [
          `Your Tovira trial ends on ${stampDate(trialEndsAt)}.`,
          'When it ends, your captured notes and everything Tovira has filed are preserved — nothing is lost.',
          'To keep using briefs, recall and the Monday statement, subscribe from Settings before then.',
        ],
      });
  }

  async sendTrialEnded(userId: string, to: string): Promise<boolean> {
    return this.once(userId, 'trial_ended', to, 'Your Tovira trial has ended',
      `Your Tovira trial has ended. Your book is preserved and you can still export it any time.\n\n` +
      `Subscribe from Settings to reopen briefs, recall and the Monday statement.`, {
        heading: 'Your trial has ended',
        intro: [
          'Your Tovira trial has ended. Your book is preserved and you can still export it any time.',
          'Subscribe from Settings to reopen briefs, recall and the Monday statement.',
        ],
      });
  }

  // [BILLING-DUNNING · D3/D4] The failed-payment emails. All list the paused AI features (D3 list, the
  // single source) and link to the payment page (the Stripe hosted invoice page / billing settings — the
  // rep completes 3DS there, ruling 2). Plain, factual tone; no threats, no countdowns.
  private pausedLine(): string {
    return `While this is unresolved, the AI features of Tovira are paused: ${pausedFeaturesSentence()}. Everything else keeps working — you can view your book, clients, facts and existing briefs, make edits, and export your data. Voice notes you record are kept and transcribed once payment succeeds.`;
  }

  async sendPaymentFailed(userId: string, to: string, eventKey: string, payUrl: string): Promise<boolean> {
    return this.once(userId, eventKey, to, 'Your Tovira payment did not go through',
      `Your last Tovira payment failed.\n\n${this.pausedLine()}\n\nUpdate your payment details to resume:\n${payUrl}`, {
        heading: 'Your payment did not go through',
        intro: ['Your last Tovira payment failed.', this.pausedLine()],
        button: { label: 'Update payment details', url: payUrl },
      });
  }

  /** D4: a reminder each day while unpaid. Day-stamped key so it sends once per day. */
  async sendPaymentReminder(userId: string, to: string, dayStamp: string, payUrl: string): Promise<boolean> {
    return this.once(userId, `dunning_reminder:${dayStamp}`, to, 'A reminder: your Tovira payment is still due',
      `Your Tovira payment has not gone through yet.\n\n${this.pausedLine()}\n\nUpdate your payment details to resume:\n${payUrl}`, {
        heading: 'Your payment is still due',
        intro: ['Your Tovira payment has not gone through yet.', this.pausedLine()],
        button: { label: 'Update payment details', url: payUrl },
      });
  }

  /** D5: suspended at day 7. Sign-in allows only the payment page and export. */
  async sendSuspended(userId: string, to: string, payUrl: string): Promise<boolean> {
    return this.once(userId, 'dunning_suspended', to, 'Your Tovira account is suspended',
      `Payment has not succeeded within 7 days, so your account is suspended. You can still sign in to update your payment details and to export your data; nothing else is available until payment succeeds.\n\nUpdate your payment details:\n${payUrl}`, {
        heading: 'Your account is suspended',
        intro: [
          'Payment has not succeeded within 7 days, so your account is suspended.',
          'You can still sign in to update your payment details and to export your data; nothing else is available until payment succeeds.',
        ],
        button: { label: 'Update payment details', url: payUrl },
      });
  }

  /** D7: ended at day 30. Restoring now needs the rep to contact us. */
  async sendSubscriptionEnded(userId: string, to: string): Promise<boolean> {
    return this.once(userId, 'dunning_ended', to, 'Your Tovira subscription has ended',
      `Payment did not succeed within 30 days, so your subscription has ended. Your data is kept for 90 days so your account can be restored.\n\nContact us at hello@tovira.io to restore your account. You can still export your data any time.`, {
        heading: 'Your subscription has ended',
        intro: [
          'Payment did not succeed within 30 days, so your subscription has ended.',
          'Your data is kept for 90 days so your account can be restored. Contact us at hello@tovira.io to restore it. You can still export your data any time.',
        ],
      });
  }

  /** D8: warn 30 days and 7 days before the post-end deletion. */
  async sendDeletionWarning(userId: string, to: string, daysLeft: 30 | 7, exportUrl: string): Promise<boolean> {
    return this.once(userId, `deletion_warning:${daysLeft}`, to, `Your Tovira data will be deleted in ${daysLeft} days`,
      `Your subscription ended and your account is scheduled for deletion in ${daysLeft} days. To keep it, contact hello@tovira.io to restore your subscription. You can export your data any time before then:\n${exportUrl}`, {
        heading: `Your data will be deleted in ${daysLeft} days`,
        intro: [
          `Your subscription ended and your account is scheduled for deletion in ${daysLeft} days.`,
          'To keep it, contact hello@tovira.io to restore your subscription. You can export your data any time before then.',
        ],
        button: { label: 'Export your data', url: exportUrl },
      });
  }

  async sendSubscriptionConfirmed(userId: string, to: string, eventKey: string, renewsAt: number | null): Promise<boolean> {
    const renews = renewsAt != null ? ` It renews on ${stampDate(renewsAt)}.` : '';
    return this.once(userId, eventKey, to, 'Your Tovira subscription is active',
      `Your Tovira subscription is active — thank you for keeping your book with us.${renews}`, {
        heading: 'Your subscription is active',
        intro: [`Your Tovira subscription is active — thank you for keeping your book with us.${renews}`],
      });
  }

  async sendSubscriptionCanceled(userId: string, to: string, eventKey: string): Promise<boolean> {
    return this.once(userId, eventKey, to, 'Your Tovira subscription is canceled',
      `Your Tovira subscription has been canceled. Your book is preserved and you can export it any time.\n\n` +
      `You can resubscribe from Settings whenever you are ready.`, {
        heading: 'Your subscription is canceled',
        intro: [
          'Your Tovira subscription has been canceled. Your book is preserved and you can export it any time.',
          'You can resubscribe from Settings whenever you are ready.',
        ],
      });
  }

  async sendAccountDeleted(userId: string, to: string): Promise<boolean> {
    return this.once(userId, 'account_deleted', to, 'Your Tovira account has been deleted',
      `Your Tovira account and all its data have been deleted, including from our training records. ` +
      `Nothing remains. If this wasn't you, contact us right away.`, {
        heading: 'Your account has been deleted',
        intro: ['Your Tovira account and all its data have been deleted, including from our training records. Nothing remains. If this wasn’t you, contact us right away.'],
      });
  }
}
