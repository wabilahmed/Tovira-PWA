import type { EmailSender } from '../../ports/email.js';
import type { EmailLogRepository } from '../../ports/email-log-repository.js';
import type { AccessRequestRecord, AccessRequestRepository } from '../../ports/access-request-repository.js';
import { renderEmail, renderText, type EmailContent } from '../email/templates.js';

/**
 * [P60 · owner] Short emails to every ADMIN_EMAILS address when someone joins and starts, in the standard Tovira
 * template with a plain-text version:
 *  - "Sara Khan (Emaar) joined via your invite": an invited lead sent the form and was approved at once
 *  - "Sara Khan signed in for the first time": once per person
 *  - [P61-7] "Sara Khan added their first client": once per person, by a chat import, a voice note or a typed note,
 *    whichever comes first
 * "Once" is the email log (one row per person per event); migration 0109 marks everyone already using Tovira, so no one
 * gets a late "first". Best-effort: a failed email never fails the rep's action.
 */
export const FIRST_SIGN_IN_KEY = 'admin.first_sign_in';
export const FIRST_CAPTURE_KEY = 'admin.first_capture';

export interface AdminEventsDeps {
  email: EmailSender;
  adminEmails: string[];
  log: EmailLogRepository;
  requests: Pick<AccessRequestRepository, 'findByLinkedUser'>;
  appBaseUrl: string;
}

export class AdminEvents {
  constructor(private readonly deps: AdminEventsDeps) {}

  /** An invited lead sent the form and was approved at once (the set-password email has gone to them). */
  async joinedViaInvite(r: AccessRequestRecord): Promise<void> {
    const how = r.ownership === 'employed'
      ? `Employed, and confirmed: "${r.employerPermissionText ?? ''}"`
      : 'Owns or manages the business.';
    await this.send(`${r.fullName} (${r.companyName}) joined via your invite`, [
      `${r.fullName}, ${r.roleTitle} at ${r.companyName}, sent the request form from your invite and was approved automatically.`,
      `The set-password email went to ${r.workEmail}.`,
      how,
    ], '/admin/access');
  }

  /** The person's first sign-in (after setting their password). Once. */
  async signedIn(userId: string, email: string): Promise<void> {
    if (!(await this.deps.log.recordIfAbsent(userId, FIRST_SIGN_IN_KEY))) return;
    const who = await this.who(userId, email);
    await this.send(`${who.name} signed in for the first time`, [`${who.line} signed in to Tovira for the first time.`], '/admin/costs');
  }

  /** [P61-7] The person's first client added: by a chat import, a voice note or a typed note, whichever comes first. */
  async captured(userId: string, email: string, kind: 'chat' | 'voice' | 'typed'): Promise<void> {
    if (!(await this.deps.log.recordIfAbsent(userId, FIRST_CAPTURE_KEY))) return;
    const who = await this.who(userId, email);
    const how = kind === 'chat' ? 'a WhatsApp chat' : kind === 'voice' ? 'a voice note' : 'a typed note';
    await this.send(`${who.name} added their first client`, [`${who.line} added their first client, with ${how}.`], '/admin/costs');
  }

  private async who(userId: string, email: string): Promise<{ name: string; line: string }> {
    const r = await this.deps.requests.findByLinkedUser(userId).catch(() => null);
    if (!r) return { name: email, line: email };
    return { name: r.fullName, line: `${r.fullName} (${r.companyName}, ${email})` };
  }

  private async send(subject: string, intro: string[], path: string): Promise<void> {
    const content: EmailContent = { heading: subject, intro, button: { label: 'Open Admin', url: `${this.deps.appBaseUrl}${path}` } };
    const text = `${renderText(content)}\n\nTovira`;
    const html = renderEmail(content);
    for (const to of this.deps.adminEmails) {
      await this.deps.email.send({ to, subject, text, html }).catch((e: unknown) => {
        console.warn('[admin-events] an admin email failed', e instanceof Error ? e.message : 'error');
      });
    }
  }
}

/** [P60] The one place a chat import, a voice note or [P61-7] a typed note is created (client page, bulk import, the share target): a note
 *  repository whose create() also tells the admin about a person's first one. The note is created first; the email is
 *  best-effort and never fails the capture. */
export function notesWithFirstCapture<T extends { create(userId: string, note: { source: string }): Promise<unknown> }>(
  notes: T,
  onCapture: (userId: string, kind: 'chat' | 'voice' | 'typed') => Promise<void>,
): T {
  return new Proxy(notes, {
    get(target, prop, receiver) {
      if (prop !== 'create') return Reflect.get(target, prop, receiver);
      return async (userId: string, note: { source: string }) => {
        const created = await target.create(userId, note);
        const kind = note.source === 'voice' ? 'voice' : note.source === 'whatsapp_export' ? 'chat' : note.source === 'paste' ? 'typed' : null;
        if (kind) await onCapture(userId, kind).catch(() => undefined);
        return created;
      };
    },
  });
}
