import { renderEmail, renderText } from '../email/templates.js';
import { FOUNDER_EMAIL, FOUNDER_FROM } from '../email/contact.js';
import { DEFAULT_TRIAL_DAYS } from '../../config.js';

/**
 * [P58-2 · owner] The hot-lead beta invite, from the founder. The shared Tovira layout (renderEmail: the same as the
 * set-password email), opened as a letter (no heading), signed by Wabil, with a plain-text version and no tracking.
 * The personal line is the admin's to edit before sending; empty falls back to the default.
 */
export const DEFAULT_PERSONAL_LINE = 'Thanks for your reply about Tovira.';
export const LEAD_INVITE_SUBJECT = 'Your Tovira beta invite';

export interface LeadInviteEmail { from: string; replyTo: string; subject: string; text: string; html: string }

export function leadInviteEmail(i: { fullName: string | null; personalLine: string | null; url: string }): LeadInviteEmail {
  const first = (i.fullName ?? '').trim().split(/\s+/)[0] || 'there';
  const personal = i.personalLine?.trim() || DEFAULT_PERSONAL_LINE;
  const content = {
    intro: [
      `Hi ${first},`,
      personal,
      `Here's your beta invite. You get ${DEFAULT_TRIAL_DAYS} days free, at no cost. The form takes a minute, and most of it is already filled in.`,
    ],
    button: { label: 'Join the Tovira beta', url: i.url },
    outro: ['Start with one client chat, or record a voice note after your next call.'],
    signoff: ['Wabil Ahmed', 'Founder, Tovira'],
    postscript: ['Not interested? Reply "no" and I won\'t email you again.'],
  };
  const text = [renderText(content), content.signoff.join('\n'), ...content.postscript].join('\n\n');
  return { from: FOUNDER_FROM, replyTo: FOUNDER_EMAIL, subject: LEAD_INVITE_SUBJECT, text, html: renderEmail(content) };
}
