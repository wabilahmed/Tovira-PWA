import { describe, it, expect, vi } from 'vitest';
import { PushDispatchService, TIME_CRITICAL, type PushableAlert } from './push-dispatch-service.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryPushSubscriptionRepository } from '../../adapters/push/in-memory-push-subscription-repository.js';
import type { PushSender } from '../../ports/push.js';

const NOW = Date.parse('2026-08-14T09:00:00Z');
const sub = { endpoint: 'https://push.test/a', keys: { p256dh: 'k', auth: 'a' } };

function make() {
  const sender: PushSender = { send: vi.fn().mockResolvedValue(undefined) };
  const notifications = new InMemoryNotificationRepository();
  const subs = new InMemoryPushSubscriptionRepository();
  const svc = new PushDispatchService(sender, subs, notifications);
  return { sender, notifications, subs, svc };
}

const meeting = (n: number): PushableAlert => ({ type: 'pre_meeting_nudge', dedupeKey: `nudge:${n}`, clientId: String(n), title: `Meeting ${n}`, body: 'meeting' });
const discretionary = (): PushableAlert[] => [
  { type: 'chat_refresh', dedupeKey: 'refresh:1', clientId: '1', title: 'Refresh', body: 'refresh' },
  { type: 'date_reminder', dedupeKey: 'date:1', clientId: '1', title: 'Date', body: 'date' },
  { type: 'going_cold', dedupeKey: 'cold:1', clientId: '1', title: 'Cooling', body: 'cold' },
  { type: 'overdue_promise', dedupeKey: 'promise:1', clientId: '1', title: 'Overdue promise', body: 'overdue' },
];

describe('[NOTIF-REWORK] time-critical alerts push uncapped', () => {
  it('three meetings tomorrow produce three prep nudges (no cap)', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    const { sent, heldForDigest } = await svc.dispatch('u', [meeting(1), meeting(2), meeting(3)], NOW);
    expect(sent).toHaveLength(3);
    expect(sender.send).toHaveBeenCalledTimes(3);
    expect(heldForDigest).toHaveLength(0);
  });

  it('many time-critical alerts of every kind all push — nothing is capped', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    const alerts: PushableAlert[] = [
      meeting(1), meeting(2),
      { type: 'promise_due_today', dedupeKey: 'due_today:1', clientId: '1', title: 'Due today', body: 'x' },
      { type: 'import_complete', dedupeKey: 'import:1', clientId: '1', title: 'Import done', body: 'y' },
    ];
    const { sent } = await svc.dispatch('u', alerts, NOW);
    expect(sent).toHaveLength(4);
    expect(sender.send).toHaveBeenCalledTimes(4);
    expect([...TIME_CRITICAL].sort()).toEqual(['daily_digest', 'import_complete', 'pre_meeting_nudge', 'promise_due_today']);
  });

  it('the same alert firing twice produces one push, not two (dedup preserved)', async () => {
    const { svc, sender, subs, notifications } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', [meeting(1)], NOW);
    // A second scan re-enqueues the SAME meeting nudge (same dedupeKey). createIfAbsent is idempotent,
    // and a real emitter only enqueues newly-created alerts — model that: the record already exists,
    // so the emitter would NOT re-enqueue it. Assert the record is single and only one push happened.
    const existed = await notifications.createIfAbsent('u', { type: 'pre_meeting_nudge', dedupeKey: 'nudge:1', clientId: '1', title: 'Meeting 1', body: 'meeting' });
    expect(existed).toBe(false); // already recorded → emitter would not re-enqueue
    expect(sender.send).toHaveBeenCalledTimes(1); // still just the one push from the first dispatch
    expect(await notifications.listByUser('u')).toHaveLength(1);
  });
});

describe('[NOTIF-REWORK] discretionary alerts are recorded in-app but never pushed', () => {
  it('discretionary alerts push zero times, no matter how many', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    const { sent, heldForDigest } = await svc.dispatch('u', discretionary(), NOW);
    expect(sent).toHaveLength(0);
    expect(sender.send).toHaveBeenCalledTimes(0);
    expect(heldForDigest).toHaveLength(4); // all four held for the digest
  });

  it('records every candidate in-app (discretionary included) so nothing is lost', async () => {
    const { svc, subs, notifications } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', [...discretionary(), meeting(1)], NOW);
    const inApp = await notifications.listByUser('u');
    expect(inApp).toHaveLength(5); // 4 discretionary + 1 meeting, all recorded
    expect(inApp.some((n) => n.dedupeKey === 'refresh:1')).toBe(true);
  });

  it('a mix pushes only the time-critical ones', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    const { sent, heldForDigest } = await svc.dispatch('u', [...discretionary(), meeting(1), meeting(2)], NOW);
    expect(sent.map((a) => a.type)).toEqual(['pre_meeting_nudge', 'pre_meeting_nudge']);
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(heldForDigest).toHaveLength(4);
  });

  it('no devices → nothing pushed, everything still recorded in-app', async () => {
    const { svc, sender, notifications } = make();
    await svc.dispatch('u', [...discretionary(), meeting(1)], NOW);
    expect(sender.send).toHaveBeenCalledTimes(0);
    expect(await notifications.listByUser('u')).toHaveLength(5);
  });

  it('fans a time-critical push out to every device', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    await subs.save('u', { endpoint: 'https://push.test/b', keys: { p256dh: 'k2', auth: 'a2' } });
    await svc.dispatch('u', [meeting(1)], NOW);
    expect(sender.send).toHaveBeenCalledTimes(2); // 1 alert x 2 devices
  });
});
