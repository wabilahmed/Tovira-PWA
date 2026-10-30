import { renderEmail, renderText } from '../email/templates.js';
import { FOUNDER_EMAIL, FOUNDER_FROM } from '../email/contact.js';
import { DEFAULT_TRIAL_DAYS } from '../../config.js';

/**
 * [P58-2 · owner] The hot-lead beta invite, from the founder. The shared Tovira layout (renderEmail: the same as the
 * set-password email), opened as a letter (no heading), signed by Wabil, with a plain-text version and no tracking.
 * The personal line is the admin's to edit before sending; empty falls back to the default.
 */
/** [P61-3] The lead's first name, properly capitalised ("wabil" → "Wabil", "SARA" → "Sara"); a mixed-case name is kept as
 *  typed ("McKenzie"). Null when there is no usable name (nothing is ever taken from an email address). */
export function firstName(fullName: string | null): string | null {
  const w = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  if (!w || w.includes('@') || !/\p{L}/u.test(w)) return null;
  const allLower = w === w.toLowerCase();
  const allUpper = w === w.toUpperCase();
  return allLower || allUpper ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
}

export const DEFAULT_PERSONAL_LINE = 'Thanks for your reply about Tovira.';
export const LEAD_INVITE_SUBJECT = 'Your Tovira beta invite';

export interface LeadInviteEmail { from: string; replyTo: string; subject: string; text: string; html: string }

export function leadInviteEmail(i: { fullName: string | null; personalLine: string | null; url: string }): LeadInviteEmail {
  const first = firstName(i.fullName) ?? 'there';
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
