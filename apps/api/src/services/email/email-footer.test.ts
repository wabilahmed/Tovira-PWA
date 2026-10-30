import { describe, it, expect } from 'vitest';
import { renderEmail } from './templates.js';
import { leadInviteEmail } from '../leads/lead-invite-email.js';

// [P61-5 · owner] The footer of every email on the shared template is "Tovira · tovira.io" and the company's legal line
// (as in the Terms), never the old "Your deal, our memory, instant success." (hype that careful readers and spam filters
// both distrust).
describe('[P61-5] the email footer', () => {
  const html = renderEmail({ heading: 'Set up your Tovira account', intro: ['x'], button: { label: 'Set up my account', url: 'https://tovira.io/invite?token=t' } });
  // plain text: every link in an email is on the app's own origin (P22-4), and this is a name, not an action
  it('"Tovira · tovira.io" and the legal line', () => {
    expect(html).toContain('Tovira · tovira.io<br>');
    expect(html).toContain('Prospera Technologies FZ-LLC, licensed by RAKEZ, United Arab Emirates');
  });
  it('NEGATIVE: the old tagline is gone, from every email (the invite too)', () => {
    expect(html).not.toMatch(/instant success/i);
    expect(leadInviteEmail({ fullName: 'Sara Khan', personalLine: null, url: 'https://tovira.io/request-access?invite=t' }).html).not.toMatch(/instant success/i);
  });
});
