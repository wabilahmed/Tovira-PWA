import { describe, it, expect, vi } from 'vitest';
import { PushDispatchService, DAILY_PUSH_CAP, type PushableAlert } from './push-dispatch-service.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryPushSubscriptionRepository } from '../../adapters/push/in-memory-push-subscription-repository.js';
import { InMemoryPushBudgetRepository } from '../../adapters/push/in-memory-push-budget-repository.js';
import type { PushSender } from '../../ports/push.js';

const NOW = Date.parse('2026-08-14T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const sub = { endpoint: 'https://push.test/a', keys: { p256dh: 'k', auth: 'a' } };

function make() {
  const sender: PushSender = { send: vi.fn().mockResolvedValue(undefined) };
  const notifications = new InMemoryNotificationRepository();
  const subs = new InMemoryPushSubscriptionRepository();
  const budget = new InMemoryPushBudgetRepository();
  const svc = new PushDispatchService(sender, subs, notifications, budget);
  return { sender, notifications, subs, budget, svc };
}

// A candidate for each rank, deliberately out of priority order.
function candidates(): PushableAlert[] {
  return [
    { type: 'chat_refresh', dedupeKey: 'refresh:1', clientId: '1', title: 'Refresh', body: 'refresh' },
    { type: 'date_reminder', dedupeKey: 'date:1', clientId: '1', title: 'Date', body: 'date' },
    { type: 'pre_meeting_nudge', dedupeKey: 'nudge:1', clientId: '1', title: 'Meeting', body: 'meeting' },
    { type: 'going_cold', dedupeKey: 'cold:1', clientId: '1', title: 'Cooling', body: 'cold' },
    { type: 'overdue_promise', dedupeKey: 'promise:1', clientId: '1', title: 'Overdue promise', body: 'overdue' },
  ];
}

describe('[SILENCE] push silence budget (max 2 pushes/rep/day)', () => {
  it('sends at most DAILY_PUSH_CAP pushes even when more alerts qualify (call-count enforced)', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    const result = await svc.dispatch('u', candidates(), NOW);
    expect(DAILY_PUSH_CAP).toBe(2);
    expect(sender.send).toHaveBeenCalledTimes(2); // exactly the cap, not 5
    expect(result.sent).toHaveLength(2);
    expect(result.suppressed).toHaveLength(3);
  });

  it('pushes the highest-priority alerts first (overdue promise > cooling > meeting > date > refresh)', async () => {
    const { svc, subs } = make();
    await subs.save('u', sub);
    const { sent, suppressed } = await svc.dispatch('u', candidates(), NOW);
    expect(sent.map((a) => a.type)).toEqual(['overdue_promise', 'going_cold']);
    expect(suppressed.map((a) => a.type)).toEqual(['pre_meeting_nudge', 'date_reminder', 'chat_refresh']);
  });

  // The product rule: a suppressed push is NOT a lost alert — it still shows in-app.
  it('records EVERY candidate as an in-app alert, pushed or suppressed', async () => {
    const { svc, subs, notifications } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', candidates(), NOW);
    const inApp = await notifications.listByUser('u');
    expect(inApp).toHaveLength(5); // all five, including the 3 that weren't pushed
    expect(inApp.some((n) => n.dedupeKey === 'refresh:1')).toBe(true); // a suppressed one
  });

  it('counts the cap per REP per DAY: a second scan the same day sends nothing more', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', candidates(), NOW);
    (sender.send as ReturnType<typeof vi.fn>).mockClear();
    await svc.dispatch('u', candidates(), NOW + 60 * 1000); // later same day
    expect(sender.send).toHaveBeenCalledTimes(0); // budget already spent today
  });

  it('resets the budget the next day', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', candidates(), NOW);
    (sender.send as ReturnType<typeof vi.fn>).mockClear();
    await svc.dispatch('u', candidates(), NOW + DAY); // next day
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('counts the cap in ALERTS, fanning each out to every device (budget is not per-device)', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    await subs.save('u', { endpoint: 'https://push.test/b', keys: { p256dh: 'k2', auth: 'a2' } });
    await svc.dispatch('u', candidates(), NOW);
    expect(sender.send).toHaveBeenCalledTimes(4); // 2 alerts x 2 devices
    // still only 2 alerts of budget spent → a same-day re-run sends nothing
    (sender.send as ReturnType<typeof vi.fn>).mockClear();
    await svc.dispatch('u', candidates(), NOW + 60 * 1000);
    expect(sender.send).toHaveBeenCalledTimes(0);
  });

  it('does nothing (no error) when the rep has no push subscriptions', async () => {
    const { svc, sender, notifications } = make();
    await svc.dispatch('u', candidates(), NOW);
    expect(sender.send).toHaveBeenCalledTimes(0);
    expect(await notifications.listByUser('u')).toHaveLength(5); // still recorded in-app
  });
});
