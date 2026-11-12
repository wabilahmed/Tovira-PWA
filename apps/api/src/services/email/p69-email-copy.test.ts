import { describe, it, expect } from 'vitest';
import { AccountEmailService, INVITE_OPENER } from './account-email-service.js';
import { leadInviteEmail } from '../leads/lead-invite-email.js';

/**
 * [P69 · owner] The emails lead with the promise: what each client cares about, in front of you when it matters (plus
 * every promise and date). The welcome's first step is one client the rep is trying to close.
 */
const OPENER = "Tovira analyses your client conversations and picks out what each client cares about, so it's in front of you when it matters. Plus every promise and date, so nothing slips.";
const START = "Start with one client you're trying to close: import the chat, record a voice note, or type what you know. Tovira will show you what they care about.";

describe('[P69] email copy', () => {
  it('the opener is the owner\'s line, with no em-dash and no "reads"', () => {
    expect(INVITE_OPENER).toBe(OPENER);
    expect(OPENER).not.toMatch(/—|\breads\b/);
  });
  it('the founder\'s beta invite opens with it, after the greeting and the personal line', () => {
    const e = leadInviteEmail({ fullName: 'Sara Khan', personalLine: null, url: 'https://tovira.io/request-access?t=x' });
    expect(e.text.split('\n\n').slice(0, 3)).toEqual(['Hi Sara,', 'Thanks for your reply about Tovira.', OPENER]);
    expect(e.html).toMatch(/Tovira analyses your client conversations and picks out what each client cares about, so it(&#39;|&#x27;|')s in front of you when it matters\./);
  });
  it('the approved-request invite and the welcome', async () => {
    const sent: Array<{ subject: string; text: string; html?: string }> = [];
    const svc = new AccountEmailService({ send: async (m: { subject: string; text: string; html?: string }) => { sent.push(m); } } as never, { recordIfAbsent: async () => true }, 'https://tovira.io');
    await svc.sendInvite('a@example.com', 'https://tovira.io/accept?t=x');
    expect(sent[0]!.text.split('\n\n')[1]).toBe(OPENER);
    await svc.sendWelcome('u1', 'a@example.com', Date.now() + 14 * 86_400_000);
    expect(sent.at(-1)!.text).toContain(START);
  });
});
