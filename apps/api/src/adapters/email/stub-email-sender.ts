import type { EmailMessage, EmailSender } from '../../ports/email.js';

/**
 * Local/test email adapter: records every send instead of delivering, so tests
 * can assert recipients, subjects and body content — and count sends for the
 * idempotency guarantees (one email per event per user).
 */
export class StubEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** All emails sent to an address (case-insensitive), newest last. */
  to(address: string): EmailMessage[] {
    const a = address.trim().toLowerCase();
    return this.sent.filter((m) => m.to.trim().toLowerCase() === a);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
