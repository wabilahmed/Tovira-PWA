import { describe, it, expect } from 'vitest';
import { AccountEmailService } from './account-email-service.js';
import { StubEmailSender } from '../../adapters/email/stub-email-sender.js';
import { InMemoryEmailLogRepository } from '../../adapters/email/in-memory-email-log-repository.js';

// [P61-2 · owner] The welcome email's trial date is shown in the rep's time zone ("15 Nov 2026"), and an email never shows
// a past date as if it were current: a trial that has already ended says so plainly, with a way to pick a plan.
const DAY = 86_400_000;
function svc() {
  const sender = new StubEmailSender();
  return { sender, email: new AccountEmailService(sender, new InMemoryEmailLogRepository(), 'https://tovira.io') };
}

describe('[P61-2] the trial date in the welcome email', () => {
  it('sent on the last day of a month, late evening UTC, in Dubai: the end date is the rep\'s local date', async () => {
    const { sender, email } = svc();
    const sentAt = Date.parse('2026-10-31T21:30:00Z'); // 1 Nov, 01:30 in Dubai
    await email.sendWelcome('u1', 'sara@emaar.example', sentAt + 14 * DAY, undefined, { timezone: 'Asia/Dubai', now: sentAt });
    expect(sender.sent[0]!.text).toContain('Your Tovira trial has started. It runs until 15 Nov 2026.');
    expect(sender.sent[0]!.html).toContain('It runs until 15 Nov 2026.');
  });
  it('sent on 31 Jan in UTC: 14 days on is 14 Feb', async () => {
    const { sender, email } = svc();
    const sentAt = Date.parse('2027-01-31T10:00:00Z');
    await email.sendWelcome('u1', 'a@x.io', sentAt + 14 * DAY, undefined, { timezone: 'UTC', now: sentAt });
    expect(sender.sent[0]!.text).toContain('It runs until 14 Feb 2027.');
  });
  it('NEGATIVE: a trial that already ended is never shown as current: "Your earlier trial ended on 6 Oct 2026. Pick a plan to continue."', async () => {
    const { sender, email } = svc();
    const now = Date.parse('2026-10-30T09:00:00Z');
    await email.sendWelcome('u1', 'wabil@prospera-technologies.com', Date.parse('2026-10-06T09:00:00Z'), undefined, { timezone: 'Asia/Dubai', now });
    const m = sender.sent[0]!;
    expect(m.text).toContain('Your earlier trial ended on 6 Oct 2026. Pick a plan to continue.');
    expect(m.text).not.toContain('runs until');
    expect(m.html).toContain('>Choose a plan</a>');
  });
});
