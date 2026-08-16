/**
 * Port: transactional email. Plain-text-first (brand §7/§10 — measured, no
 * urgency, no emoji). Business logic depends on THIS interface, never on an
 * email SDK; the stub records sends for tests, the SES adapter delivers in prod
 * (a config swap at the composition root, P0-2).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body — the source of truth for every email. */
  text: string;
  /** Optional HTML; when absent the client shows the text. */
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
