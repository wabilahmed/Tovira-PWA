import type { EmailSender } from '../../ports/email.js';
import type { EmailLogRepository } from '../../ports/email-log-repository.js';

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
 * no urgency, errors say what happened + what to do). Plain-text is the source
 * of truth. Lifecycle sends are idempotent: one per (user, event) — a replayed
 * webhook or a re-run scheduler never double-sends.
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
    });
  }

  /** Send a lifecycle email once. Returns true if it was sent (false = already sent). */
  private async once(userId: string, eventKey: string, to: string, subject: string, text: string): Promise<boolean> {
    if (!(await this.log.recordIfAbsent(userId, eventKey))) return false;
    await this.email.send({ to, subject, text: text + SIGNOFF });
    return true;
  }

  async sendWelcome(userId: string, to: string, trialEndsAt: number, verifyUrl?: string): Promise<boolean> {
    const confirm = verifyUrl
      ? `\n\nWhen you have a moment, confirm your email so we can reach you about your trial:\n${verifyUrl}`
      : '';
    return this.once(userId, 'welcome', to, 'Welcome to Tovira',
      `Your Tovira trial has started. It runs until ${stampDate(trialEndsAt)}.\n\n` +
      `Export one WhatsApp chat to see what your book has been hiding — that is the whole setup.` +
      confirm);
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
    });
  }

  /** The conversion moment: two days before the trial ends. */
  async sendTrialEnding(userId: string, to: string, trialEndsAt: number): Promise<boolean> {
    return this.once(userId, 'trial_ending', to, 'Your Tovira trial ends in two days',
      `Your Tovira trial ends on ${stampDate(trialEndsAt)}.\n\n` +
      `When it ends, your captured notes and everything Tovira has filed are preserved — nothing is lost. ` +
      `To keep using briefs, recall and the Monday statement, subscribe from Settings before then.`);
  }

  async sendTrialEnded(userId: string, to: string): Promise<boolean> {
    return this.once(userId, 'trial_ended', to, 'Your Tovira trial has ended',
      `Your Tovira trial has ended. Your book is preserved and you can still export it any time.\n\n` +
      `Subscribe from Settings to reopen briefs, recall and the Monday statement.`);
  }

  async sendPaymentFailed(userId: string, to: string, eventKey: string): Promise<boolean> {
    return this.once(userId, eventKey, to, 'Your Tovira payment did not go through',
      `Your last Tovira payment failed, so your subscription is past due.\n\n` +
      `Update your billing details from Settings to keep access. Your data is not affected.`);
  }

  async sendSubscriptionConfirmed(userId: string, to: string, eventKey: string, renewsAt: number | null): Promise<boolean> {
    const renews = renewsAt != null ? ` It renews on ${stampDate(renewsAt)}.` : '';
    return this.once(userId, eventKey, to, 'Your Tovira subscription is active',
      `Your Tovira subscription is active — thank you for keeping your book with us.${renews}`);
  }

  async sendSubscriptionCanceled(userId: string, to: string, eventKey: string): Promise<boolean> {
    return this.once(userId, eventKey, to, 'Your Tovira subscription is canceled',
      `Your Tovira subscription has been canceled. Your book is preserved and you can export it any time.\n\n` +
      `You can resubscribe from Settings whenever you are ready.`);
  }

  async sendAccountDeleted(userId: string, to: string): Promise<boolean> {
    return this.once(userId, 'account_deleted', to, 'Your Tovira account has been deleted',
      `Your Tovira account and all its data have been deleted, including from our training records. ` +
      `Nothing remains. If this wasn't you, contact us right away.`);
  }
}
