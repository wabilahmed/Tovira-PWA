import type { EmailMessage, EmailSender } from '../../ports/email.js';

export interface ResendEmailSenderOptions {
  apiKey: string;
  /** Verified sender identity, e.g. "Tovira <no-reply@tovira.io>". */
  from: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/**
 * Resend transactional email adapter (prod). Talks to the Resend HTTP API
 * directly (no SDK dependency); the fetch impl is injected so tests need no
 * network. Plain-text is always sent; HTML is added when present. Only this file
 * knows about Resend — everything else depends on the EmailSender port (P0-2).
 */
export class ResendEmailSender implements EmailSender {
  constructor(private readonly opts: ResendEmailSenderOptions) {}

  async send(message: EmailMessage): Promise<void> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(`${this.opts.baseUrl ?? 'https://api.resend.com'}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.opts.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`resend send failed: ${res.status} ${detail.slice(0, 300)}`);
    }
  }
}
