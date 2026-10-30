import { describe, it, expect } from 'vitest';
import { leadInviteEmail, DEFAULT_PERSONAL_LINE } from './lead-invite-email.js';
import { renderEmail } from '../email/templates.js';

// [P58-2 · owner] The hot-lead beta invite: from the founder, the shared Tovira email layout (the same renderEmail as
// the set-password email: the wordmark header, colours, type, the button, the footer), a plain-text version, and no
// tracking pixels. The personal line is the admin's to edit; it defaults to "Thanks for your reply about Tovira."
const URL_ = 'https://tovira.io/request-access?invite=tok123';

describe('[P58-2] the invite email', () => {
  const e = leadInviteEmail({ fullName: 'Sara Khan', personalLine: null, url: URL_ });
  it('sender, reply-to and subject', () => {
    expect(e.from).toBe('"Wabil Ahmed, Tovira" <wabil@tovira.io>');
    expect(e.replyTo).toBe('wabil@tovira.io');
    expect(e.subject).toBe('Your Tovira beta invite');
  });
  it('the plain-text version, word for word', () => {
    expect(e.text).toBe([
      'Hi Sara,',
      'Thanks for your reply about Tovira.',
      "Here's your beta invite. You get 14 days free, at no cost. The form takes a minute, and most of it is already filled in.",
      `Join the Tovira beta:\n${URL_}`,
      'Start with one client chat, or record a voice note after your next call.',
      'Wabil Ahmed\nFounder, Tovira',
      'Not interested? Reply "no" and I won\'t email you again.',
    ].join('\n\n'));
  });
  it('the HTML: the shared layout, one button to the link, the signature, no tracking pixel', () => {
    expect(e.html).toContain('<span style="color:#d14821;">T</span>o<span style="color:#d14821;">v</span>ira'); // the header wordmark
    expect(e.html).toContain('Your deal, our memory, instant success.'); // the standard footer
    expect(e.html).toContain(`href="${URL_}"`);
    expect(e.html).toContain('>Join the Tovira beta</a>');
    expect(e.html).toContain('Wabil Ahmed');
    expect(e.html).toContain('Founder, Tovira');
    expect(e.html).toContain('Not interested? Reply "no" and I won\'t email you again.');
    expect(e.html).not.toMatch(/<img/i);
    expect(e.html.match(/href=/g)).toHaveLength(1); // the one link
  });
  it('the personal line is the admin\'s, escaped; empty falls back to the default', () => {
    expect(leadInviteEmail({ fullName: 'Sara Khan', personalLine: 'Great to meet you at <GITEX>.', url: URL_ }).html).toContain('Great to meet you at &lt;GITEX&gt;.');
    expect(leadInviteEmail({ fullName: 'Sara Khan', personalLine: '   ', url: URL_ }).text).toContain(DEFAULT_PERSONAL_LINE);
    expect(DEFAULT_PERSONAL_LINE).toBe('Thanks for your reply about Tovira.');
  });
  it('the first name only; a missing name reads "Hi there,"', () => {
    expect(leadInviteEmail({ fullName: '  Mohammed Al Kaabi ', personalLine: null, url: URL_ }).text.startsWith('Hi Mohammed,')).toBe(true);
    expect(leadInviteEmail({ fullName: '', personalLine: null, url: URL_ }).text.startsWith('Hi there,')).toBe(true);
  });
  it('NEGATIVE: no em-dash anywhere in the copy', () => {
    expect(e.text).not.toContain('—');
  });
});

describe('[P58-2] the shared template: existing emails are unchanged', () => {
  it('a heading and the "Tovira" sign-off by default, as before', () => {
    const html = renderEmail({ heading: 'Set up your Tovira account', intro: ['x'], button: { label: 'Set up my account', url: 'https://tovira.io/invite?token=t' } });
    expect(html).toContain('<h1 style=');
    expect(html).toContain('<p style="margin:22px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#6b645d;">Tovira</p>');
  });
});

// [P61-3 · owner] The greeting is the lead's first name from the lead record, properly capitalised ("wabil" → "Wabil"),
// never the email address; "Hi there," when there is no name. A name already mixed-case is kept as typed.
describe('[P61-3] the greeting', () => {
  const hi = (fullName: string | null) => leadInviteEmail({ fullName, personalLine: null, url: URL_ }).text.split('\n')[0];
  it('capitalises a lower- or upper-case first name', () => {
    expect(hi('wabil')).toBe('Hi Wabil,');
    expect(hi('wabil ahmed')).toBe('Hi Wabil,');
    expect(hi('SARA KHAN')).toBe('Hi Sara,');
    expect(hi('  mohammed al kaabi ')).toBe('Hi Mohammed,');
  });
  it('keeps a mixed-case name as typed', () => {
    expect(hi('McKenzie Ross')).toBe('Hi McKenzie,');
    expect(hi('DeShawn Lee')).toBe('Hi DeShawn,');
  });
  it('NEGATIVE: no name → "Hi there,", never anything from an email address', () => {
    expect(hi(null)).toBe('Hi there,');
    expect(hi('')).toBe('Hi there,');
    expect(hi('wabil@prospera-technologies.com')).toBe('Hi there,');
  });
  it('the default personal line, pinned', () => {
    expect(leadInviteEmail({ fullName: 'Sara Khan', personalLine: null, url: URL_ }).text.split('\n\n')[1]).toBe('Thanks for your reply about Tovira.');
  });
});
