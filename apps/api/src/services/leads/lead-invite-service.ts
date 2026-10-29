import { createHash, randomBytes } from 'node:crypto';
import type { HotLead, HotLeadsStore } from '../../ports/hot-leads.js';
import { LEAD_INVITE_RESEND_AFTER_MS, LEAD_INVITE_TTL_MS } from '../../ports/hot-leads.js';
import type { EmailSender } from '../../ports/email.js';
import type { UserRepository } from '../../ports/user-repository.js';
import { leadInviteEmail, type LeadInviteEmail } from './lead-invite-email.js';

/**
 * [P58 · owner] Admin → Leads → "Send invite email". The founder emails a hot lead a beta invite; its one button opens
 * the request form at tovira.io with a single-purpose token (the raw token is only in the email; only its hash is
 * stored). The form loads the lead's name, email, company and job title with it; no personal data rides in the URL.
 *  - one invite per lead; a Resend after 3 days, once (it replaces the token); the link lives 14 days
 *  - never to a lead marked Not interested, one with an account, an erased contact, or one already on the Access tab
 *  - used once: the submitted request is the lead's (Requested), and it is approved at once (the founder chose them)
 */
export const hashInviteToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export type InviteRefusal = { code: 'erased' | 'missing' | 'not_interested' | 'has_account' | 'requested' | 'on_access_tab' | 'already_sent' | 'too_soon' | 'already_resent' | 'not_sent' | 'send_failed'; message: string };
export interface LeadInviteDeps {
  store: HotLeadsStore;
  users: Pick<UserRepository, 'findByEmail'>;
  email: EmailSender;
  /** The app's public origin (https://tovira.io): the link is `${appBaseUrl}/request-access?invite=<token>`. */
  appBaseUrl: string;
  now?: () => number;
}

export class LeadInviteService {
  private readonly now: () => number;
  constructor(private readonly deps: LeadInviteDeps) { this.now = deps.now ?? (() => Date.now()); }

  /** Why this lead can't be emailed at all (null when it can). */
  async refusal(lead: HotLead): Promise<InviteRefusal | null> {
    if (lead.erased) return { code: 'erased', message: 'This contact asked to be removed. They can\'t be emailed.' };
    if (!lead.email || !lead.name) return { code: 'missing', message: 'This lead has no name or email to invite.' };
    if (lead.status === 'not_interested') return { code: 'not_interested', message: 'Marked Not interested. They won\'t be emailed.' };
    if (lead.status === 'signed_up' || (await this.deps.users.findByEmail(lead.email.trim().toLowerCase()))) return { code: 'has_account', message: 'They already have an account.' };
    if (lead.status === 'requested') return { code: 'requested', message: 'They already sent the form.' };
    if (lead.accessRequestId) return { code: 'on_access_tab', message: 'This lead already has an access request, on the Access tab.' };
    return null;
  }

  /** What would be sent, with a placeholder link: nothing is stored or sent. */
  preview(lead: HotLead, personalLine: string | null): LeadInviteEmail & { to: string } {
    return { to: lead.email ?? '', ...leadInviteEmail({ fullName: lead.name, personalLine, url: `${this.deps.appBaseUrl}/request-access?invite=PREVIEW` }) };
  }

  /** Send (or, with resend, re-send) the invite. The token is recorded first (a conditional write), then the email
   *  goes; an email that fails is undone, so the admin can try again. */
  async send(lead: HotLead, personalLine: string | null, resend: boolean): Promise<{ ok: true; lead: HotLead } | { ok: false; refusal: InviteRefusal }> {
    const r = await this.refusal(lead);
    if (r) return { ok: false, refusal: r };
    const at = this.now();
    if (!resend && lead.inviteSentAt != null) return { ok: false, refusal: { code: 'already_sent', message: 'The invite was already sent. Resend opens 3 days after it.' } };
    if (resend) {
      if (lead.inviteSentAt == null) return { ok: false, refusal: { code: 'not_sent', message: 'No invite was sent yet.' } };
      if (lead.inviteResentAt != null) return { ok: false, refusal: { code: 'already_resent', message: 'The invite was already re-sent once.' } };
      if (at < lead.inviteSentAt + LEAD_INVITE_RESEND_AFTER_MS) {
        const opens = new Date(lead.inviteSentAt + LEAD_INVITE_RESEND_AFTER_MS);
        return { ok: false, refusal: { code: 'too_soon', message: `Resend opens on ${opens.toISOString().slice(0, 10)}, 3 days after the invite.` } };
      }
    }
    const raw = randomBytes(32).toString('base64url');
    const updated = await this.deps.store.setInvite(lead.id, { tokenHash: hashInviteToken(raw), at, expiresAt: at + LEAD_INVITE_TTL_MS, resend });
    if (!updated) return { ok: false, refusal: { code: resend ? 'already_resent' : 'already_sent', message: resend ? 'The invite was already re-sent once.' : 'The invite was already sent.' } };
    const e = leadInviteEmail({ fullName: lead.name, personalLine, url: `${this.deps.appBaseUrl}/request-access?invite=${encodeURIComponent(raw)}` });
    try {
      await this.deps.email.send({ to: lead.email!.trim(), subject: e.subject, text: e.text, html: e.html, from: e.from, replyTo: e.replyTo });
    } catch (err) {
      console.warn('lead invite email failed; the send is undone so it can be tried again', err);
      await this.deps.store.restoreInvite(lead.id, { status: lead.status, inviteSentAt: lead.inviteSentAt ?? null, inviteResentAt: lead.inviteResentAt ?? null, inviteExpiresAt: lead.inviteExpiresAt ?? null }, this.now());
      return { ok: false, refusal: { code: 'send_failed', message: 'The email could not be sent. Nothing was recorded; try again.' } };
    }
    return { ok: true, lead: updated };
  }

  /** The lead behind a live link, still eligible; null shows the normal empty form. */
  async leadForToken(rawToken: string): Promise<HotLead | null> {
    if (!rawToken || rawToken.length > 200) return null;
    const lead = await this.deps.store.findByInviteToken(hashInviteToken(rawToken), this.now());
    if (!lead || lead.erased || lead.status === 'not_interested' || !lead.email) return null;
    return lead;
  }

  /** What the form is prefilled with: the four fields the lead's record holds. */
  async prefill(rawToken: string): Promise<{ fullName: string; workEmail: string; companyName: string; roleTitle: string } | null> {
    const lead = await this.leadForToken(rawToken);
    return lead ? { fullName: lead.name ?? '', workEmail: lead.email!.trim().toLowerCase(), companyName: lead.companyName ?? '', roleTitle: lead.jobTitle ?? '' } : null;
  }

  /** Use the token once, for this submitted request: the lead becomes Requested. Null when it was used meanwhile. */
  async claim(lead: HotLead, rawToken: string, accessRequestId: string): Promise<HotLead | null> {
    return this.deps.store.markRequested(lead.id, hashInviteToken(rawToken), accessRequestId, this.now());
  }
}

