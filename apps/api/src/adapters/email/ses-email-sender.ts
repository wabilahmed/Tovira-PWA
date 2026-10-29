import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { EmailMessage, EmailSender } from '../../ports/email.js';
import { CONTACT_EMAIL, assertOwnSender } from '../../services/email/contact.js';

/** Minimal SES surface we use — lets tests inject a fake with no AWS creds. */
export interface SesLike {
  send(command: SendEmailCommand): Promise<unknown>;
}

export interface SesEmailSenderOptions {
  client: SesLike;
  /** Verified sender identity, e.g. "Tovira <hello@tovira.io>". */
  from: string;
}

/**
 * AWS SES v2 email adapter (prod). The concrete SESv2Client is injected so the
 * adapter carries no creds and stays testable; only this adapter file touches
 * the SDK. Plain-text is always sent; HTML is added when the message has it.
 */
export class SesEmailSender implements EmailSender {
  constructor(private readonly opts: SesEmailSenderOptions) {}

  async send(message: EmailMessage): Promise<void> {
    assertOwnSender(message.from); // [P58-1]
    assertOwnSender(message.replyTo);
    await this.opts.client.send(
      new SendEmailCommand({
        FromEmailAddress: message.from ?? this.opts.from,
        ReplyToAddresses: [message.replyTo ?? CONTACT_EMAIL], // [D9] hello@tovira.io unless the message says ([P58-1])
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject },
            Body: {
              Text: { Data: message.text },
              ...(message.html ? { Html: { Data: message.html } } : {}),
            },
          },
        },
      }),
    );
  }
}
