import { describe, it, expect, vi } from 'vitest';
import { MondayDigestService } from './monday-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryPushSubscriptionRepository } from '../../adapters/push/in-memory-push-subscription-repository.js';
import { InMemoryPushBudgetRepository } from '../../adapters/push/in-memory-push-budget-repository.js';
import { PushDispatchService } from '../push/push-dispatch-service.js';
import type { PushSender } from '../../ports/push.js';

const NOW = Date.parse('2026-08-03T09:00:00Z'); // a Monday
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sub = { endpoint: 'https://push.test/a', keys: { p256dh: 'k', auth: 'a' } };

function make() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const notifications = new InMemoryNotificationRepository();
  const subs = new InMemoryPushSubscriptionRepository();
  const budget = new InMemoryPushBudgetRepository();
  const sender: PushSender = { send: vi.fn().mockResolvedValue(undefined) };
  const pushDispatch = new PushDispatchService(sender, subs, notifications, budget);
  const svc = new MondayDigestService(clients, notes, facts, notifications, 30, pushDispatch);
  return { clients, notes, facts, notifications, subs, budget, sender, pushDispatch, svc };
}

describe('[TZ-BOUNDARY] MondayDigestService computes the week on the rep\'s clock', () => {
  // 2026-08-02 22:00 UTC is still SUNDAY in UTC, but already MONDAY 02:00 in Dubai (+4).
  const NOW_SUN = Date.parse('2026-08-02T22:00:00Z');

  function withTz(tz: string) {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const facts = new InMemoryFactsRepository();
    const notifications = new InMemoryNotificationRepository();
    const subs = new InMemoryPushSubscriptionRepository();
    const budget = new InMemoryPushBudgetRepository();
    const pushDispatch = new PushDispatchService({ send: vi.fn().mockResolvedValue(undefined) }, subs, notifications, budget);
    const svc = new MondayDigestService(clients, notes, facts, notifications, 30, pushDispatch, async () => tz);
    return { clients, facts, svc };
  }

  it('a Dubai rep gets the NEW week; a UTC rep is still in the old week — same instant', async () => {
    expect((await withTz('Etc/UTC').svc.build('u', NOW_SUN)).weekOf).toBe('2026-07-27'); // Monday of the UTC (Sun) week
    expect((await withTz('Asia/Dubai').svc.build('u', NOW_SUN)).weekOf).toBe('2026-08-03'); // Monday where the rep is
  });

  it('the this-week window follows the rep\'s local today: a promise due on the UTC date is out of the Dubai week', async () => {
    const utc = withTz('Etc/UTC'); const dubai = withTz('Asia/Dubai');
    for (const h of [utc, dubai]) {
      const c = await h.clients.create('u', 'Acme');
      await h.facts.saveExtraction('u', { noteId: 'n', clientId: c.id, promises: [{ text: 'due today-UTC', owner: 'rep', due_date: '2026-08-02', due_raw: null, confidence: 'high' }] });
    }
    expect((await utc.svc.build('u', NOW_SUN)).promisesDue.map((p) => p.text)).toContain('due today-UTC');
    expect((await dubai.svc.build('u', NOW_SUN)).promisesDue.map((p) => p.text)).not.toContain('due today-UTC'); // 08-02 < Dubai today 08-03
  });
});

describe('MondayDigestService (P3-8)', () => {
  it('digests exactly this week\'s due promises and cooling clients', async () => {
    const { clients, facts, svc } = make();
    const c = await clients.create('u', 'Acme');
    const cold = await clients.create('u', 'Quiet Co');
    (cold as { lastTouchedAt: number }).lastTouchedAt = NOW - 40 * DAY; // cooling
    await facts.saveExtraction('u', {
      noteId: 'n', clientId: c.id,
      promises: [
        { text: 'send quote', owner: 'rep', due_date: iso(NOW + 1 * DAY), due_raw: null, confidence: 'high' },
        { text: 'call finance', owner: 'rep', due_date: iso(NOW + 4 * DAY), due_raw: null, confidence: 'high' },
        { text: 'next month thing', owner: 'rep', due_date: iso(NOW + 40 * DAY), due_raw: null, confidence: 'high' }, // out of week
      ],
    });
    const digest = await svc.build('u', NOW);
    expect(digest.promisesDue.map((p) => p.text).sort()).toEqual(['call finance', 'send quote']);
    expect(digest.coolingClients).toHaveLength(1);
    expect(digest.isLight).toBe(false);
  });

  // NEVER PADDED: a clear week is stated honestly, not filled with stale items.
  it('returns an honest light digest for a clear week', async () => {
    const { clients, svc } = make();
    await clients.create('u', 'Warm Co'); // just touched, nothing due
    const digest = await svc.build('u', NOW);
    expect(digest.isLight).toBe(true);
    expect(digest.promisesDue).toEqual([]);
    expect(digest.coolingClients).toEqual([]);
  });

  it('surfaces unanswered questions and upcoming dates', async () => {
    const { clients, notes, facts, svc } = make();
    const c = await clients.create('u', 'Acme');
    const note = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 't', audioKey: null, status: 'extracted', messages: [] });
    await notes.update('u', note.id, { extracted: { unanswered_questions: [{ question: 'bulk pricing?', sentAt: '2026-07-01T10:00:00', sender: 'Acme' }] } });
    await facts.saveExtraction('u', { noteId: 'n', clientId: c.id, promises: [], keyDates: [{ description: 'launch', date: iso(NOW + 2 * DAY), date_raw: null, type: 'launch' }] });
    const digest = await svc.build('u', NOW);
    expect(digest.unansweredQuestions[0]!.question).toBe('bulk pricing?');
    expect(digest.upcomingDates[0]!.description).toBe('launch');
  });

  // IDEMPOTENT: re-running the same week does not send a second digest.
  it('sends the weekly notification only once per week', async () => {
    const { clients, svc, notifications } = make();
    await clients.create('u', 'Acme');
    expect(await svc.notifyMonday('u', NOW)).toBe(true);
    expect(await svc.notifyMonday('u', NOW + DAY)).toBe(false); // same week → no second digest
    expect(await notifications.listByUser('u')).toHaveLength(1);
  });

  // [FLOWS / silence budget] the Monday push goes through the SAME ranked, capped
  // dispatcher as every other alert — brand §10 "max 2/day, no exceptions".
  it('pushes the Monday digest through the silence budget when budget remains', async () => {
    const { clients, subs, sender, svc } = make();
    await clients.create('u', 'Acme');
    await subs.save('u', sub);
    await svc.notifyMonday('u', NOW);
    expect(sender.send).toHaveBeenCalledTimes(1); // pushed to the one device, within budget
  });

  it('suppresses the Monday push when the daily budget is spent, but still records it in-app', async () => {
    const { clients, subs, budget, sender, notifications, svc } = make();
    await clients.create('u', 'Acme');
    await subs.save('u', sub);
    await budget.recordSent('u', iso(NOW), 2); // the 2/day cap is already used
    await svc.notifyMonday('u', NOW);
    expect(sender.send).not.toHaveBeenCalled(); // no exception to the cap
    expect(await notifications.listByUser('u')).toHaveLength(1); // suppressed from push ≠ lost
  });

  it('never includes another rep\'s data', async () => {
    const { clients, facts, svc } = make();
    const c = await clients.create('a', 'A Co');
    await facts.saveExtraction('a', { noteId: 'n', clientId: c.id, promises: [{ text: 'a secret', owner: 'rep', due_date: iso(NOW + 1 * DAY), due_raw: null, confidence: 'high' }] });
    const digest = await svc.build('b', NOW);
    expect(digest.promisesDue).toEqual([]);
    expect(digest.isLight).toBe(true);
  });
});
