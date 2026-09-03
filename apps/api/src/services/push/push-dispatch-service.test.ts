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

// One non-meeting candidate per rank, deliberately out of priority order. These SHARE the cap.
function nonMeeting(): PushableAlert[] {
  return [
    { type: 'chat_refresh', dedupeKey: 'refresh:1', clientId: '1', title: 'Refresh', body: 'refresh' },
    { type: 'date_reminder', dedupeKey: 'date:1', clientId: '1', title: 'Date', body: 'date' },
    { type: 'going_cold', dedupeKey: 'cold:1', clientId: '1', title: 'Cooling', body: 'cold' },
    { type: 'overdue_promise', dedupeKey: 'promise:1', clientId: '1', title: 'Overdue promise', body: 'overdue' },
  ];
}
const meeting = (n: number): PushableAlert => ({ type: 'pre_meeting_nudge', dedupeKey: `nudge:${n}`, clientId: String(n), title: `Meeting ${n}`, body: 'meeting' });

describe('[SILENCE] the 2/day cap governs non-meeting alerts', () => {
  it('sends at most DAILY_PUSH_CAP non-meeting pushes even when more qualify', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    const result = await svc.dispatch('u', nonMeeting(), NOW);
    expect(DAILY_PUSH_CAP).toBe(2);
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(result.sent).toHaveLength(2);
    expect(result.suppressed).toHaveLength(2);
  });

  it('pushes the highest-priority non-meeting alerts first (overdue > cooling > date > refresh)', async () => {
    const { svc, subs } = make();
    await subs.save('u', sub);
    const { sent, suppressed } = await svc.dispatch('u', nonMeeting(), NOW);
    expect(sent.map((a) => a.type)).toEqual(['overdue_promise', 'going_cold']);
    expect(suppressed.map((a) => a.type)).toEqual(['date_reminder', 'chat_refresh']);
  });

  it('records EVERY candidate as an in-app alert, pushed or suppressed', async () => {
    const { svc, subs, notifications } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', nonMeeting(), NOW);
    const inApp = await notifications.listByUser('u');
    expect(inApp).toHaveLength(4);
    expect(inApp.some((n) => n.dedupeKey === 'refresh:1')).toBe(true); // a suppressed one, still in-app
  });

  it('counts the cap per REP per DAY: a second scan the same day sends nothing more', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', nonMeeting(), NOW);
    (sender.send as ReturnType<typeof vi.fn>).mockClear();
    await svc.dispatch('u', nonMeeting(), NOW + 60 * 1000);
    expect(sender.send).toHaveBeenCalledTimes(0);
  });

  it('resets the budget the next day', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', nonMeeting(), NOW);
    (sender.send as ReturnType<typeof vi.fn>).mockClear();
    await svc.dispatch('u', nonMeeting(), NOW + DAY);
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('counts the cap in ALERTS, fanning each out to every device', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    await subs.save('u', { endpoint: 'https://push.test/b', keys: { p256dh: 'k2', auth: 'a2' } });
    await svc.dispatch('u', nonMeeting(), NOW);
    expect(sender.send).toHaveBeenCalledTimes(4); // 2 alerts x 2 devices
  });

  it('does nothing (no error) when the rep has no push subscriptions, still records in-app', async () => {
    const { svc, sender, notifications } = make();
    await svc.dispatch('u', nonMeeting(), NOW);
    expect(sender.send).toHaveBeenCalledTimes(0);
    expect(await notifications.listByUser('u')).toHaveLength(4);
  });
});

describe('[NUDGE-RANK] pre-meeting nudges outrank everything and are exempt from the cap', () => {
  it('a meeting nudge outranks every other alert', async () => {
    const { svc, subs } = make();
    await subs.save('u', sub);
    const { sent } = await svc.dispatch('u', [...nonMeeting(), meeting(1)], NOW);
    expect(sent[0]?.type).toBe('pre_meeting_nudge'); // loudest, first
  });

  it('a meeting nudge is NEVER suppressed by the cap, even when non-meeting alerts fill it', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    const { sent, suppressed } = await svc.dispatch('u', [...nonMeeting(), meeting(1)], NOW);
    // meeting + 2 non-meeting (the cap) all send; the other 2 non-meeting are suppressed
    expect(sent.map((a) => a.type)).toEqual(['pre_meeting_nudge', 'overdue_promise', 'going_cold']);
    expect(suppressed.map((a) => a.type)).toEqual(['date_reminder', 'chat_refresh']);
    expect(sender.send).toHaveBeenCalledTimes(3);
    expect(suppressed.some((a) => a.type === 'pre_meeting_nudge')).toBe(false);
  });

  it('a rep with three meetings in a day gets all three nudges (cap of 2 does not apply)', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    const { sent, suppressed } = await svc.dispatch('u', [meeting(1), meeting(2), meeting(3)], NOW);
    expect(sent).toHaveLength(3);
    expect(sender.send).toHaveBeenCalledTimes(3);
    expect(suppressed).toHaveLength(0);
  });

  it('meeting nudges do NOT consume the cap: non-meeting alerts still get their 2', async () => {
    const { svc, subs } = make();
    await subs.save('u', sub);
    const { sent } = await svc.dispatch('u', [meeting(1), meeting(2), ...nonMeeting()], NOW);
    const nonMeetingSent = sent.filter((a) => a.type !== 'pre_meeting_nudge');
    expect(nonMeetingSent).toHaveLength(2); // the full non-meeting budget, untouched by the 2 meetings
    expect(sent.filter((a) => a.type === 'pre_meeting_nudge')).toHaveLength(2);
  });

  it('meeting nudges spent today do not eat tomorrow\'s (or today\'s) non-meeting budget', async () => {
    const { svc, sender, subs } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', [meeting(1), meeting(2), meeting(3)], NOW); // 3 meetings, exempt
    (sender.send as ReturnType<typeof vi.fn>).mockClear();
    await svc.dispatch('u', nonMeeting(), NOW + 60 * 1000); // same day
    expect(sender.send).toHaveBeenCalledTimes(2); // non-meeting budget was never touched by the meetings
  });

  it('a suppressed non-meeting alert still lands in-app even when a meeting took priority', async () => {
    const { svc, subs, notifications } = make();
    await subs.save('u', sub);
    await svc.dispatch('u', [...nonMeeting(), meeting(1)], NOW);
    const inApp = await notifications.listByUser('u');
    expect(inApp).toHaveLength(5); // 4 non-meeting + 1 meeting, all recorded
    expect(inApp.some((n) => n.dedupeKey === 'refresh:1')).toBe(true);
  });
});
