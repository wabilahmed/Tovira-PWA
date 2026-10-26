import type { AccessRequestRecord } from '../../ports/access-request-repository.js';
import type { EmailMessage } from '../../ports/email.js';
import { appLinks } from '../email/email-links.js';

/**
 * [P46-6c.3] One admin address list (ADMIN_EMAILS) for everything the operator is told: a new access request and the
 * AI spend alert go to every admin. One failed address never stops the others. No ADMIN_EMAILS → nothing is sent.
 */
export function accessRequestNotifier(
  email: { sendAccessRequestNotification(to: string, r: AccessRequestRecord, approveUrl: string, reviewUrl?: string): Promise<void> },
  adminEmails: string[],
  appBaseUrl: string,
): ((rec: AccessRequestRecord) => Promise<void>) | undefined {
  if (adminEmails.length === 0) return undefined;
  const links = appLinks(appBaseUrl);
  return async (rec) => {
    for (const to of adminEmails) {
      await email.sendAccessRequestNotification(to, rec, links.opsApprove(rec.id), links.opsAccess).catch((e: unknown) => {
        console.warn('[access-request] notification failed for one admin address', e instanceof Error ? e.message : 'error');
      });
    }
  };
}

export function adminAlertSender(sender: { send(m: EmailMessage): Promise<void> }, adminEmails: string[]) {
  return async (m: { subject: string; text: string }): Promise<void> => {
    for (const to of adminEmails) await sender.send({ to, ...m }).catch(() => undefined);
  };
}
