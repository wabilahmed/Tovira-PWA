import { describe, it, expect, vi } from 'vitest';
import { TrialEmailService } from './trial-email-service.js';
import { AccountEmailService } from './account-email-service.js';
import { StubEmailSender } from '../../adapters/email/stub-email-sender.js';
import { InMemoryEmailLogRepository } from '../../adapters/email/in-memory-email-log-repository.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-01T09:00:00Z');

function make(trialing: Array<{ userId: string; trialEndsAt: number }>) {
  const email = new StubEmailSender();
  const account = new AccountEmailService(email, new InMemoryEmailLogRepository());
  const subs = { listTrialing: vi.fn(async () => trialing) };
  const emails: Record<string, string> = { u1: 'u1@x.com', u2: 'u2@x.com' };
  const svc = new TrialEmailService(subs, async (id) => emails[id] ?? null, account);
  return { email, svc, subs, trialing };
}

describe('[EMAIL-HOOKS 1a] TrialEmailService', () => {
  it('sends trial-ending ~2 days out, once per trial even on re-runs', async () => {
    const trialing = [{ userId: 'u1', trialEndsAt: NOW + 2 * DAY }];
    const { email, svc } = make(trialing);
    expect(await svc.run(NOW)).toEqual({ ending: 1, ended: 0 });
    expect(email.to('u1@x.com').filter((m) => /trial ends in two days/i.test(m.subject))).toHaveLength(1);
    // re-run the same day → idempotent, no second send
    await svc.run(NOW);
    expect(email.to('u1@x.com').filter((m) => /trial ends in two days/i.test(m.subject))).toHaveLength(1);
  });

  it('does not send trial-ending outside the ~2-day window', async () => {
    const { email, svc } = make([{ userId: 'u1', trialEndsAt: NOW + 5 * DAY }]);
    expect(await svc.run(NOW)).toEqual({ ending: 0, ended: 0 });
    expect(email.sent).toHaveLength(0);
  });

  it('a trial extended before the email fires sends once against the NEW end date, never a duplicate', async () => {
    const trialing = [{ userId: 'u1', trialEndsAt: NOW + 2 * DAY }];
    const { email, svc } = make(trialing);
    await svc.run(NOW); // fires for the old date
    expect(email.to('u1@x.com')).toHaveLength(1);
    // extend +7 days; the window no longer matches, and the log already blocks it
    trialing[0]!.trialEndsAt = NOW + 9 * DAY;
    await svc.run(NOW);
    await svc.run(NOW + 7 * DAY); // now 2 days out from the new date
    expect(email.to('u1@x.com').filter((m) => /trial ends in two days/i.test(m.subject))).toHaveLength(1); // still one
  });

  it('sends trial-ended once for an expired, unconverted trial', async () => {
    const { email, svc } = make([{ userId: 'u1', trialEndsAt: NOW - DAY }]);
    expect(await svc.run(NOW)).toEqual({ ending: 0, ended: 1 });
    expect(email.to('u1@x.com').filter((m) => /trial has ended/i.test(m.subject))).toHaveLength(1);
    await svc.run(NOW); // idempotent
    expect(email.to('u1@x.com').filter((m) => /trial has ended/i.test(m.subject))).toHaveLength(1);
  });

  it('isolates a failing send: one bad address never stops the rest', async () => {
    const boom: AccountEmailService = {
      sendTrialEnding: vi.fn().mockRejectedValueOnce(new Error('SES down')).mockResolvedValue(true),
      sendTrialEnded: vi.fn().mockResolvedValue(true),
    } as unknown as AccountEmailService;
    const subs = { listTrialing: vi.fn(async () => [{ userId: 'u1', trialEndsAt: NOW + 2 * DAY }, { userId: 'u2', trialEndsAt: NOW + 2 * DAY }]) };
    const svc = new TrialEmailService(subs, async (id) => `${id}@x.com`, boom);
    await expect(svc.run(NOW)).resolves.toBeTruthy(); // never throws
    expect((boom.sendTrialEnding as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2); // both attempted
  });
});
